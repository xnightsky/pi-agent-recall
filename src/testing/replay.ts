/** 确定性回放使用真实公共 core；不会读取时钟、自动补 fence 或访问宿主。 */
import { createPolicyCore } from "../core/index.js";
import type {
  AttentionConfig, AttentionDecision, CommitResult, DeliveryResult, EvaluateInput,
  PolicyCore, PolicyCoreOptions, PolicyState, PrepareInput, PrepareResult, TransitionEvent, TransitionResult,
} from "../core/index.js";
import { array, member, object } from "../core/validation.js";
import { copy } from "../core/input-validation.js";
import { createFakeSink, type FakeSink, type FakeSubmission } from "./sink.js";

/** 明确记录外部发生的事件；没有 timer、队列或隐式重试事件。 */
export type ReplayEvent =
  | { kind: "evaluate"; input: EvaluateInput; delivery?: { input: PrepareInput; result: DeliveryResult } }
  | { kind: "config"; config: AttentionConfig }
  | { kind: "transition"; event: TransitionEvent }
  | { kind: "close" };

/** 单步观测保留决策、prepare 与 commit 的不同语义。 */
export type ReplayObservation =
  | { kind: "evaluate"; decision: AttentionDecision; preparation?: PrepareResult; receipt?: CommitResult }
  | { kind: "config" | "close" }
  | { kind: "transition"; result: TransitionResult };

/** 回放结果只证明契约行为，不提供采用或净收益分数。 */
export interface ReplayResult {
  events: ReplayObservation[];
  state: PolicyState;
  submissions: FakeSubmission[];
}

function validateEvent(value: unknown): asserts value is ReplayEvent {
  const raw = object(value, "event", ["kind", "input", "delivery", "config", "event"]);
  member(raw.kind, ["evaluate", "config", "transition", "close"], "event.kind");
  const keys = { evaluate: ["kind", "input", "delivery"], config: ["kind", "config"],
    transition: ["kind", "event"], close: ["kind"] };
  object(value, "event", keys[raw.kind as keyof typeof keys]);
  if (raw.delivery !== undefined) {
    const delivery = object(raw.delivery, "delivery", ["input", "result"]);
    member(delivery.result, ["submitted", "failed", "unknown"], "delivery.result");
  }
}

function evaluate(core: PolicyCore, sink: FakeSink, event: Extract<ReplayEvent, { kind: "evaluate" }>): ReplayObservation {
  const decision = core.evaluate(event.input);
  if (decision.kind === "silent" || !event.delivery) return { kind: "evaluate", decision };
  const preparation = core.prepareDelivery(decision.reservation.id, event.delivery.input);
  if (preparation.status !== "ready") return { kind: "evaluate", decision, preparation };
  sink.setResult(event.delivery.result);
  // 该同步边界内不 await，不运行 lifecycle/config 回调。
  const result = sink.submit(preparation.permit);
  const receipt = core.commitDelivery(preparation.permit, result, event.delivery.input.now);
  return { kind: "evaluate", decision, preparation, receipt };
}

/** 相同 options 与有序事件得到相同结果；最大 10,000 步以限制测试工件大小。 */
export function replay(options: PolicyCoreOptions, events: readonly ReplayEvent[]): ReplayResult {
  const checked = array(events, "events", 10_000).map(event => { validateEvent(event); return event; });
  const core = createPolicyCore(options);
  const sink = createFakeSink();
  const output: ReplayObservation[] = [];
  for (const event of checked) {
    switch (event.kind) {
      case "evaluate": output.push(evaluate(core, sink, event)); break;
      case "config": core.applyConfig(event.config); output.push({ kind: "config" }); break;
      case "transition": output.push({ kind: "transition", result: core.transition(event.event) }); break;
      case "close": core.close(); output.push({ kind: "close" }); break;
    }
  }
  return copy({ events: output, state: core.getState(), submissions: sink.getCalls() });
}
