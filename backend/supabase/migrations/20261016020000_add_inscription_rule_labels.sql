BEGIN;
ALTER TABLE public.verifier_rules ADD COLUMN rule_label text;
COMMENT ON COLUMN public.verifier_rules.rule_label IS 'Optional admin label for specific inscription selections; never an ownership or collection membership criterion';
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_label_check CHECK (
  rule_label IS NULL OR (inscription_criteria IS NOT NULL
    AND char_length(rule_label) BETWEEN 1 AND 100
    AND rule_label = btrim(rule_label)
    AND rule_label !~ '[[:cntrl:]]')
);
NOTIFY pgrst, 'reload schema';
COMMIT;
