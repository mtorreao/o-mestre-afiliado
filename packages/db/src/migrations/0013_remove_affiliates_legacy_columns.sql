-- Remove colunas legadas da tabela affiliates que foram migradas para mirrors
ALTER TABLE omestre.affiliates
  DROP COLUMN IF EXISTS source_groups,
  DROP COLUMN IF EXISTS target_groups,
  DROP COLUMN IF EXISTS excluded_groups,
  DROP COLUMN IF EXISTS message_template,
  DROP COLUMN IF EXISTS filters,
  DROP COLUMN IF EXISTS last_validated_at,
  DROP COLUMN IF EXISTS last_validation_passed,
  DROP COLUMN IF EXISTS last_validation_report;
