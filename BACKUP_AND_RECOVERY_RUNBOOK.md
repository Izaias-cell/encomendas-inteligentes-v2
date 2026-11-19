# ENCOMENDAS INTELIGENTES — Runbook de Backup, PITR e Recuperação

Este documento define os procedimentos operacionais obrigatórios de proteção, cópia de segurança e teste de restauração para o ambiente de produção do **Encomendas Inteligentes**.

---

## 1. Banco de Dados Supabase (PostgreSQL)

### 1.1 Backups Automáticos e Point-in-Time Recovery (PITR)
- **Obrigatório em produção:** Habilitar **Point-in-Time Recovery (PITR)** no projeto Supabase (Dashboard → *Database → Backups*).
- Retenção mínima recomendada: **7 a 30 dias** de PITR contínuo para recuperação granular até o segundo anterior a qualquer incidente lógico ou operacional.
- Caso o plano atual utilize apenas *Daily Backups*, confirmar o horário diário de janela automática e documentar o RPO (24h).

### 1.2 Backup Lógico Complementar (`pg_dump`)
Antes de qualquer migração ou alteração estrutural (ex.: aplicação de `supabase_migration_security_hardening.sql`):
```bash
# Exportação lógica somente dados + esquema (utilizar string de conexão direta do Supabase)
pg_dump --format=custom --no-owner --no-privileges \
  --file="backup_encomendas_$(date +%Y%m%d_%H%M%S).dump" \
  "$SUPABASE_DB_URL"
```
Armazenar o arquivo `.dump` em repositório seguro criptografado fora do servidor da aplicação.

### 1.3 Uso do Snapshot Interno do Painel Administrativo
- O endpoint `POST /api/admin/backup-snapshot` gera snapshots JSON operacionais em `auditoria_eventos` (`tipo_evento = 'SYSTEM_BACKUP_SNAPSHOT'`).
- **Limitação importante:** Esse snapshot interno **não substitui** `pg_dump` nem PITR do Supabase, pois não exporta todas as tabelas relacionais completas nem arquivos do Storage. Deve ser tratado apenas como registro auxiliar rápido.

---

## 2. Supabase Storage (`bucket: packages`)

As fotos de cadastro e entrega das encomendas ficam armazenadas no bucket `packages`.
- Manter inventário periódico e sincronização incremental do bucket para armazenamento secundário seguro (ex.: `rclone` / script usando `supabase.storage.from('packages').list()` + download em storage externo).
- Nunca executar limpeza em massa de objetos no bucket sem confirmar a janela de retenção legal definida pelo condomínio.

---

## 3. Procedimento de Teste de Restauração em Staging (Mensal)

1. Provisionar/selecionar o projeto **Staging** isolado (nunca restaurar sobre produção).
2. Restaurar o último snapshot lógico ou ponto PITR em Staging:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-privileges \
     --dbname="$STAGING_DB_URL" \
     backup_encomendas_YYYYMMDD_HHMMSS.dump
   ```
3. Executar `GET /api/admin/integrity-check` autenticado como `admin` em Staging e confirmar `status: "HEALTHY"` (zero perfis, moradores ou encomendas órfãs).
4. Validar login administrativo, ativação de Portaria via `portaria_access_code`, consulta de encomendas e abertura de link `/retirada?token=...`.
5. Registrar data, responsável, RPO e tempo total de recuperação (RTO) no histórico operacional do condomínio/plataforma.
