-- Mantém o progresso já salvo para a categoria que passou a usar o
-- identificador público "antigo_testamento".
UPDATE daily_readings
SET category = 'antigo_testamento'
WHERE category = 'at_historia';
