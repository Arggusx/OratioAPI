-- Comunidade do Oratio: contador coletivo, novenas em grupo, metas e mural de intenções.
-- Nada aqui identifica uma pessoa: "participant" é um hash (com chave secreta do servidor) de um código
-- aleatório gerado no aparelho, e "ip_hash" é um hash diário do IP, usado só para limitar envios.
-- Rode no Neon (SQL Editor) com o usuário dono do banco. Pode ser executado mais de uma vez.

-- Cada marcação: terço rezado no dia, dia de novena, etc. Uma por pessoa, por tipo, por dia.
CREATE TABLE IF NOT EXISTS community_events (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('terco', 'novena')),
  ref TEXT NOT NULL DEFAULT '',
  day DATE NOT NULL,
  participant TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, ref, day, participant)
);

CREATE INDEX IF NOT EXISTS community_events_kind_day ON community_events (kind, day);
CREATE INDEX IF NOT EXISTS community_events_ip_day ON community_events (ip_hash, day);

-- Metas da comunidade (ex.: 10 mil terços no Advento). O progresso é a contagem de terços no período.
CREATE TABLE IF NOT EXISTS community_goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('terco')),
  target INTEGER NOT NULL CHECK (target > 0),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL
);

INSERT INTO community_goals (id, title, kind, target, starts_on, ends_on)
VALUES ('advento-2026', '10 mil terços no Advento', 'terco', 10000, '2026-11-29', '2026-12-24')
ON CONFLICT (id) DO NOTHING;

-- Mural de intenções. Pedidos somem da lista depois de 30 dias ou com 3 denúncias.
CREATE TABLE IF NOT EXISTS community_intentions (
  id BIGSERIAL PRIMARY KEY,
  text VARCHAR(280) NOT NULL,
  first_name VARCHAR(30),
  ip_hash TEXT NOT NULL,
  participant TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_intentions_recent ON community_intentions (created_at DESC) WHERE NOT hidden;

-- "Rezei por você": uma vez por pessoa em cada pedido.
CREATE TABLE IF NOT EXISTS community_intention_prayers (
  intention_id BIGINT NOT NULL REFERENCES community_intentions (id) ON DELETE CASCADE,
  participant TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (intention_id, participant)
);

-- Denúncias: uma por pessoa em cada pedido. Para esconder, contam IPs diferentes (não aparelhos),
-- para que uma só pessoa não consiga apagar um pedido gerando códigos novos.
CREATE TABLE IF NOT EXISTS community_intention_reports (
  intention_id BIGINT NOT NULL REFERENCES community_intentions (id) ON DELETE CASCADE,
  participant TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (intention_id, participant)
);

-- Permissões do usuário da aplicação (o mesmo papel com privilégio mínimo usado pela API).
GRANT SELECT, INSERT ON community_events TO oratio_app;
GRANT USAGE ON SEQUENCE community_events_id_seq TO oratio_app;
GRANT SELECT ON community_goals TO oratio_app;
GRANT SELECT, INSERT, UPDATE ON community_intentions TO oratio_app;
GRANT USAGE ON SEQUENCE community_intentions_id_seq TO oratio_app;
GRANT SELECT, INSERT ON community_intention_prayers TO oratio_app;
GRANT SELECT, INSERT ON community_intention_reports TO oratio_app;

-- Índices para o limite por IP.
CREATE INDEX IF NOT EXISTS community_prayers_ip ON community_intention_prayers (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS community_reports_ip ON community_intention_reports (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS community_intentions_ip ON community_intentions (ip_hash, created_at);
