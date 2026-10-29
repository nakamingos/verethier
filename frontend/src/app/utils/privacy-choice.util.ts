/** Defaults are a draft for new members; saved choices remain authoritative. */
export function privacyChoiceDraft(policy: any) {
  const defaults = policy.has_saved_choice === false;
  return {
    epoch: policy.epoch,
    share: !!policy.sharing_enabled && (defaults || !!policy.share_since),
    exports: defaults || !!policy.export_since,
    notice: policy.notice,
  };
}
