/** 公共数据契约的编译期消费者；不从私有模块导入类型。 */
import type {
  AnchorMetadata, AttentionCandidate, AttentionConfig, PolicyCore, PolicyFence,
  EvaluateInput, DeliveryPermit, DeliveryResult, PolicyState, TransitionEvent,
} from "../../src/core/index.js";

/** 编译期签名检查，供后续行为 fixture 使用同一接口。 */
export function consumeCore(core: PolicyCore, input: EvaluateInput, config: AttentionConfig): PolicyState {
  const candidate: AttentionCandidate = input.candidate;
  const fence: PolicyFence = candidate.fence;
  const anchor: AnchorMetadata | undefined = input.anchor;
  const transition: TransitionEvent = { kind: "activity", fence, provenance: "external", now: input.now };
  core.evaluate({ candidate, ...(anchor ? { anchor } : {}), now: input.now });
  core.applyConfig(config);
  core.transition(transition);
  return core.getState();
}

/** 回执只表达宿主提交结果，不含采用推断。 */
export function consumeReceipt(core: PolicyCore, permit: DeliveryPermit, result: DeliveryResult, now: number) {
  return core.commitDelivery(permit, result, now);
}
