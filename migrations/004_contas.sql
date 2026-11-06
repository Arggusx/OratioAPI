-- Contas do Oratio: login com Google para guardar o progresso da Jornada em mais de um aparelho,
-- e o aceite (opcional) das mensagens periódicas por e-mail.
-- Guardamos só o necessário: o identificador da conta Google ("sub"), o e-mail, o primeiro nome
-- e o progresso. Apagar a conta apaga tudo (ON DELETE CASCADE).
-- Rode no Neon (SQL Editor) com o usuário dono do banco. Pode ser executado mais de uma vez.

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name VARCHAR(80),
  wants_messages BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O mesmo objeto que o site guarda no aparelho (chave "oratio:jornada"), em JSON.
CREATE TABLE IF NOT EXISTS user_progress (
  user_id BIGINT PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha por pessoa e por dia em que a mensagem foi enviada: o cron não manda duas vezes.
CREATE TABLE IF NOT EXISTS message_log (
  user_id BIGINT NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  sent_on DATE NOT NULL,
  PRIMARY KEY (user_id, sent_on)
);

CREATE INDEX IF NOT EXISTS app_users_wants_messages ON app_users (id) WHERE wants_messages;

-- Permissões do usuário da aplicação (privilégio mínimo).
GRANT SELECT, INSERT, UPDATE, DELETE ON app_users TO oratio_app;
GRANT USAGE ON SEQUENCE app_users_id_seq TO oratio_app;
GRANT SELECT, INSERT, UPDATE ON user_progress TO oratio_app;
GRANT SELECT, INSERT ON message_log TO oratio_app;
