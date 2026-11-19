/**
 * SUITE DE HOMOLOGAÇÃO DAS CORREÇÕES DE REGRESSÃO E OPERACIONALIDADE
 *
 * Cobre todos os cenários corrigidos após a auditoria de regressões:
 * 1. Portal (/validate, /validate-code, /package): serializa unit_type, block, bloco e permite
 *    morador inativo apenas quando houver >= 1 encomenda pendente em condomínio ativo (404 caso contrário)
 * 2. Código curto legado (4-8 chars): GET /api/portal/package/:code retorna requiresVerification=true
 *    sem PII; POST /api/portal/verify-legacy-code valida 2o fator (unidade ou últimos 4 dígitos)
 *    e GET /api/portal/my-packages atende sessão autenticada de morador
 * 3. Rate limits calibrados: /api/portal/validate-code permite 35 tentativas (<40) e limita na 41a;
 *    /api/ocr/extract-basic permite 55 chamadas (<60) e limita na 61a
 * 4. Fluxo completo da Portaria via token de sessão (SEM JWT Auth): context, cadastro/edição/lote
 *    de moradores, upload-photo, packages/create (agrupamento + existingPendingPackages),
 *    whatsapp-status, message-logs, audit POST, packages GET, deliver POST, dashboard GET
 * 5. Isolamento multi-tenant (403) e RBAC nas rotas operacionais (Portaria bloqueada em audit GET,
 *    condominium-settings PUT, packages/clear POST e DELETE packages/:id; Admin/Síndico autorizados)
 * 6. Isolamento estrito e validação individual de destinatários em lote em POST /api/packages/create
 *    (zero uploads e zero gravações parciais antes da validação de condomínio e destinatários)
 * 7. Conflito entre identificadores de condomínio em POST /api/packages/create (condominiumId vs
 *    condominium_id vs packages[].condominium_id/condominiumId) rejeitado com 403 e zero writes/uploads
 * 8. Pré-validação integral de fotografias em lote (formato JPEG/PNG, base64 válido e limite 5MB)
 *    antes de qualquer upload no Storage ou gravação no banco
 * 9. POST /api/condominiums/create fallback de colunas ausentes + auto-vínculo de perfil sem condomínio;
 *    PUT /api/admin/condominiums/:id permite active=false ao Admin Global revogando active_portaria_token
 *    e bloqueia Síndico (403)
 * 10. Lembretes automáticos 48h/72h desativados (/api/cron/reminders -> 410; sem checkboxes em SyndicPanel.tsx)
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  sumPackageItems,
  isPackageNotificationConfirmed,
  isPackageDelivered,
  getGroupNotificationSummary,
  shouldShowOperationalNotifyHeader,
  getPackageNotificationBadgeState,
  getPackagesNeedingNotification,
  canShowResendButton,
  getConfirmedPackagesForResend,
  parseQrScanInput,
  validateQrScanResult,
} from '../lib/packageUtils';
import { feedback } from '../lib/feedback';
import { executeManualSendConfirmation, shouldOpenManualWhatsAppOnCreate } from '../services/whatsappConfirmationService';
import { INACTIVITY_ALERT_TIMEOUT_MS, shouldShowInactivityAlert } from '../services/activitySyncService';

process.env.VERCEL = '1';

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  } else {
    console.error(`❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

type Row = Record<string, any>;

class RegressionMockSupabase {
  tables: Record<string, Row[]> = {
    condominiums: [],
    condominium_settings: [],
    profiles: [],
    moradores: [],
    packages: [],
    retrieval_logs: [],
    resident_access_tokens: [],
    notifications: [],
    message_logs: [],
    whatsapp_conversations: [],
    whatsapp_webhook_events: [],
    auditoria_eventos: [],
  };

  authTokens: Map<string, { id: string; email: string }> = new Map();
  simulateMissingCondoExtendedColumns = false;
  simulatePackagesUpdateError = false;
  simulateMissingNotifiedAtColumn = false;
  uploadCount = 0;
  packageWriteCount = 0;
  packageSelectLogs: Array<{ select: string; rangeStart: number | null; rangeEnd: number | null }> = [];

  createClient() {
    const db = this;

    const enrichSelect = (table: string, row: Row, selectStr: string): Row => {
      const cloned = { ...row };
      if (table === 'packages' && selectStr.includes('moradores')) {
        const res = db.tables.moradores.find((m) => m.id === row.recipient_id) || null;
        cloned.moradores = res ? { ...res } : null;
      }
      if ((table === 'packages' || table === 'moradores') && selectStr.includes('condominiums')) {
        const condo = db.tables.condominiums.find((c) => c.id === row.condominium_id) || null;
        cloned.condominiums = condo ? { ...condo } : null;
      }
      return cloned;
    };

    const parseOrExpr = (expr: string): ((row: Row) => boolean) => {
      const clauses = expr.split(',').map((c) => c.trim()).filter(Boolean);
      return (row: Row) =>
        clauses.some((clause) => {
          const dotParts = clause.split('.');
          if (dotParts.length >= 3) {
            const col = dotParts[0];
            const op = dotParts[1];
            const val = dotParts.slice(2).join('.');
            if (op === 'eq') return String(row[col] ?? '') === val;
            if (op === 'ilike') {
              const needle = val.replace(/^%+|%+$/g, '').toLowerCase();
              return String(row[col] ?? '').toLowerCase().includes(needle);
            }
          }
          return false;
        });
    };

    const makeBuilder = (table: string) => {
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let selectStr = '*';
      let selectOptions: any = {};
      let insertRows: Row[] = [];
      let updatePatch: Row = {};
      const filters: Array<(row: Row) => boolean> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitVal: number | null = null;
      let rangeStart: number | null = null;
      let rangeEnd: number | null = null;
      let singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
      let returnRows = false;

      const execute = async (): Promise<{ data: any; error: any; count?: number }> => {
        if (!db.tables[table]) db.tables[table] = [];

        if (mode === 'select') {
          if (table === 'packages' && db.simulateMissingNotifiedAtColumn && selectStr.includes('notified_at')) {
            return {
              data: null,
              error: { code: '42703', message: 'column packages.notified_at does not exist' },
            };
          }
          let rows = db.tables[table]
            .filter((r) => filters.every((fn) => fn(r)))
            .map((r) => enrichSelect(table, r, selectStr));

          if (orderCol) {
            rows.sort((a, b) => {
              const av = a[orderCol!] ?? '';
              const bv = b[orderCol!] ?? '';
              if (av < bv) return orderAsc ? -1 : 1;
              if (av > bv) return orderAsc ? 1 : -1;
              return 0;
            });
          }

          if (table === 'packages') {
            db.packageSelectLogs.push({ select: selectStr, rangeStart, rangeEnd });
          }

          const totalCount = rows.length;
          if (rangeStart !== null && rangeEnd !== null) {
            rows = rows.slice(rangeStart, Math.min(rangeEnd + 1, rangeStart + 1000));
          } else if (limitVal !== null) {
            rows = rows.slice(0, limitVal);
          } else {
            // Simulate PostgREST max_rows=1000 cap on unpaginated queries
            rows = rows.slice(0, 1000);
          }

          if (selectOptions?.head) {
            return { data: null, error: null, count: totalCount };
          }
          if (singleMode === 'single') {
            if (rows.length !== 1) return { data: null, error: { message: `Row not found in ${table}` } };
            return { data: rows[0], error: null, count: totalCount };
          }
          if (singleMode === 'maybeSingle') {
            return { data: rows[0] || null, error: null, count: totalCount };
          }
          return { data: rows, error: null, count: totalCount };
        }

        if (mode === 'insert') {
          if (table === 'condominiums' && db.simulateMissingCondoExtendedColumns) {
            const hasExt = insertRows.some(
              (r) =>
                'city_state' in r ||
                'manager_name' in r ||
                'manager_phone' in r ||
                'manager_email' in r ||
                'rules' in r ||
                'internal_notes' in r
            );
            if (hasExt) {
              return {
                data: null,
                error: { code: '42703', message: 'column "city_state" of relation "condominiums" does not exist' },
              };
            }
          }

          if (table === 'packages' && db.simulateMissingNotifiedAtColumn) {
            const hasNotifiedAt = insertRows.some((r) => 'notified_at' in r) || selectStr.includes('notified_at');
            if (hasNotifiedAt) {
              return {
                data: null,
                error: { code: 'PGRST204', message: "Could not find the 'notified_at' column of 'packages' in the schema cache" },
              };
            }
          }

          if (table === 'packages') {
            db.packageWriteCount += insertRows.length;
          }
          const inserted = insertRows.map((raw) => {
            const row = {
              id: raw.id || crypto.randomUUID(),
              created_at: raw.created_at || new Date().toISOString(),
              criado_em: raw.criado_em || new Date().toISOString(),
              ...raw,
            };
            db.tables[table].push(row);
            return enrichSelect(table, row, selectStr);
          });

          if (!returnRows) return { data: null, error: null };
          if (singleMode === 'single' || singleMode === 'maybeSingle') {
            return { data: inserted[0] || null, error: null };
          }
          return { data: inserted, error: null };
        }

        if (mode === 'update') {
          if (table === 'packages' && db.simulatePackagesUpdateError) {
            return { data: null, error: { message: 'Simulated database write error on packages update' } };
          }
          if (table === 'packages' && db.simulateMissingNotifiedAtColumn) {
            if ('notified_at' in updatePatch || selectStr.includes('notified_at')) {
              return {
                data: null,
                error: { code: 'PGRST204', message: "Could not find the 'notified_at' column of 'packages' in the schema cache" },
              };
            }
          }
          if (table === 'packages') {
            db.packageWriteCount += 1;
          }
          const updated: Row[] = [];
          db.tables[table] = db.tables[table].map((row) => {
            if (filters.every((fn) => fn(row))) {
              const next = { ...row, ...updatePatch };
              updated.push(enrichSelect(table, next, selectStr));
              return next;
            }
            return row;
          });
          if (!returnRows) return { data: null, error: null };
          if (singleMode === 'single') {
            if (updated.length !== 1) return { data: null, error: { message: `Update single failed on ${table}` } };
            return { data: updated[0], error: null };
          }
          if (singleMode === 'maybeSingle') {
            return { data: updated[0] || null, error: null };
          }
          return { data: updated, error: null };
        }

        if (mode === 'delete') {
          const kept: Row[] = [];
          const removed: Row[] = [];
          for (const row of db.tables[table]) {
            if (filters.every((fn) => fn(row))) removed.push(row);
            else kept.push(row);
          }
          db.tables[table] = kept;
          return { data: returnRows ? removed : null, error: null };
        }

        return { data: null, error: null };
      };

      const builder: any = {
        select(cols = '*', opts: any = {}) {
          if (mode !== 'select') returnRows = true;
          selectStr = cols;
          selectOptions = opts || {};
          return builder;
        },
        insert(payload: Row | Row[]) {
          mode = 'insert';
          insertRows = Array.isArray(payload) ? payload : [payload];
          return builder;
        },
        update(patch: Row) {
          mode = 'update';
          updatePatch = { ...patch };
          return builder;
        },
        delete() {
          mode = 'delete';
          return builder;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return builder;
        },
        in(col: string, vals: any[]) {
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        ilike(col: string, val: string) {
          const needle = String(val || '').replace(/^%+|%+$/g, '').toLowerCase();
          if (val.startsWith('%') || val.endsWith('%')) {
            filters.push((r) => String(r[col] || '').toLowerCase().includes(needle));
          } else {
            filters.push((r) => String(r[col] || '').toLowerCase() === needle);
          }
          return builder;
        },
        or(expr: string) {
          filters.push(parseOrExpr(expr));
          return builder;
        },
        is(col: string, val: any) {
          filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
          return builder;
        },
        lt(col: string, val: string) {
          filters.push((r) => String(r[col] || '') < String(val));
          return builder;
        },
        lte(col: string, val: string) {
          filters.push((r) => String(r[col] || '') <= String(val));
          return builder;
        },
        gte(col: string, val: string) {
          filters.push((r) => String(r[col] || '') >= String(val));
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          limitVal = n;
          return builder;
        },
        range(start: number, end: number) {
          rangeStart = start;
          rangeEnd = end;
          return builder;
        },
        single() {
          singleMode = 'single';
          return execute();
        },
        maybeSingle() {
          singleMode = 'maybeSingle';
          return execute();
        },
        then(onFulfilled: any, onRejected: any) {
          return execute().then(onFulfilled, onRejected);
        },
      };

      return builder;
    };

    return {
      from: (table: string) => makeBuilder(table),
      storage: {
        from: (_bucket: string) => ({
          upload: async (fileName: string) => {
            db.uploadCount += 1;
            return { data: { path: fileName }, error: null };
          },
          getPublicUrl: (fileName: string) => ({
            data: { publicUrl: `https://mock-storage.local/packages/${fileName}` },
          }),
        }),
      },
      auth: {
        getUser: async (token: string) => {
          const u = db.authTokens.get(token);
          if (!u) return { data: { user: null }, error: { message: 'Invalid JWT' } };
          return { data: { user: u }, error: null };
        },
        admin: {
          listUsers: async () => ({
            data: { users: Array.from(db.authTokens.values()) },
            error: null,
          }),
          getUserById: async (id: string) => {
            const found = Array.from(db.authTokens.values()).find((u) => u.id === id) || null;
            return { data: { user: found }, error: found ? null : { message: 'User not found' } };
          },
          createUser: async ({ email }: any) => {
            const id = crypto.randomUUID();
            const user = { id, email };
            db.authTokens.set(`tok-${id}`, user);
            return { data: { user }, error: null };
          },
          updateUserById: async (id: string) => ({ data: { user: { id } }, error: null }),
          signOut: async (_id: string) => ({ data: {}, error: null }),
          deleteUser: async (_id: string) => ({ data: {}, error: null }),
        },
      },
    };
  }
}

async function requestJson(
  port: number,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; raw: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const rawBody = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };
    if (rawBody !== undefined && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (rawBody !== undefined) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(rawBody));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = text;
          try {
            parsed = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode || 0, data: parsed, raw: text, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

async function runTests() {
  const { createApp } = await import('../../server.ts');

  const CONDO_A = '10101010-1010-4010-8010-101010101010';
  const CONDO_B = '20202020-2020-4020-8020-202020202020';
  const ADMIN_ID = 'aaaa0000-0000-4000-8000-000000000001';
  const SINDICO_ID = 'bbbb0000-0000-4000-8000-000000000002';
  const UNLINKED_ADMIN_ID = 'cccc0000-0000-4000-8000-000000000003';
  const PORTEIRO_A_ID = 'abab0000-0000-4000-8000-000000000009';
  const RESIDENT_USER_ID = 'dddd0000-0000-4000-8000-000000000004';
  const RES_INACTIVE_WITH_PKG_ID = 'eeee0000-0000-4000-8000-000000000005';
  const RES_INACTIVE_NO_PKG_ID = 'ffff0000-0000-4000-8000-000000000006';
  const RESIDENT_A2_ID = '11110000-0000-4000-8000-000000000007';
  const RESIDENT_B_ID = '22220000-0000-4000-8000-000000000008';

  const TOKEN_ADMIN = 'reg-jwt-admin';
  const TOKEN_SINDICO = 'reg-jwt-sindico';
  const TOKEN_UNLINKED_ADMIN = 'reg-jwt-unlinked-admin';
  const TOKEN_PORTEIRO_A = 'reg-jwt-porteiro-a';
  const TOKEN_RESIDENT_USER = 'reg-jwt-resident-user';
  const TOKEN_PORTARIA_A = 'reg_portaria_session_alpha_token_12345';

  const db = new RegressionMockSupabase();
  db.authTokens.set(TOKEN_ADMIN, { id: ADMIN_ID, email: 'admin@reg.com' });
  db.authTokens.set(TOKEN_SINDICO, { id: SINDICO_ID, email: 'sindico@reg.com' });
  db.authTokens.set(TOKEN_UNLINKED_ADMIN, { id: UNLINKED_ADMIN_ID, email: 'unlinked@reg.com' });
  db.authTokens.set(TOKEN_PORTEIRO_A, { id: PORTEIRO_A_ID, email: 'porteiro@reg.com' });
  db.authTokens.set(TOKEN_RESIDENT_USER, { id: RESIDENT_USER_ID, email: 'morador@reg.com' });

  db.tables.condominiums.push(
    { id: CONDO_A, name: 'Condomínio Aurora', address: 'Av. Aurora, 10', active: true },
    { id: CONDO_B, name: 'Condomínio Brisa', address: 'Av. Brisa, 20', active: true }
  );

  db.tables.condominium_settings.push({
    id: crypto.randomUUID(),
    condominium_id: CONDO_A,
    portaria_name: 'Portaria Aurora',
    portaria_access_code: 'AURO-5511',
    active_portaria_token: TOKEN_PORTARIA_A,
  });

  db.tables.profiles.push(
    { id: ADMIN_ID, full_name: 'Admin Reg', role: 'admin', condominium_id: CONDO_A, active: true },
    { id: SINDICO_ID, full_name: 'Síndico Aurora', role: 'sindico', condominium_id: CONDO_A, active: true },
    { id: PORTEIRO_A_ID, full_name: 'Porteiro Aurora', role: 'porteiro', condominium_id: CONDO_A, active: true },
    { id: UNLINKED_ADMIN_ID, full_name: 'Admin Novo Sem Condomínio', role: 'admin', condominium_id: null, active: true },
    { id: RESIDENT_USER_ID, full_name: 'Carlos Morador', role: 'morador', condominium_id: CONDO_A, unit: '305', unidade: '305', active: true }
  );

  db.tables.moradores.push(
    {
      id: RES_INACTIVE_WITH_PKG_ID,
      condominium_id: CONDO_A,
      nome: 'Clara Pendente',
      unidade: '204',
      unit_type: 'Casa',
      block: 'Torre Sul',
      bloco: 'Torre Sul',
      telefone: '5511991112233',
      ativo: false,
    },
    {
      id: RES_INACTIVE_NO_PKG_ID,
      condominium_id: CONDO_A,
      nome: 'Marcos Inativo Sem Pacote',
      unidade: '909',
      unit_type: 'Apartamento',
      block: 'Bloco C',
      bloco: 'Bloco C',
      telefone: '5511994445566',
      ativo: false,
    },
    {
      id: RESIDENT_USER_ID,
      condominium_id: CONDO_A,
      nome: 'Carlos Morador',
      unidade: '305',
      unit_type: 'Apartamento',
      block: 'Bloco B',
      bloco: 'Bloco B',
      telefone: '5511988776655',
      ativo: true,
    },
    {
      id: RESIDENT_A2_ID,
      condominium_id: CONDO_A,
      nome: 'Beatriz Aurora',
      unidade: '402',
      unit_type: 'Apartamento',
      block: 'Bloco A',
      bloco: 'Bloco A',
      telefone: '5511977665544',
      ativo: true,
    },
    {
      id: RESIDENT_B_ID,
      condominium_id: CONDO_B,
      nome: 'Rafael Brisa',
      unidade: '101',
      unit_type: 'Apartamento',
      block: 'Bloco Único',
      bloco: 'Bloco Único',
      telefone: '5511966554433',
      ativo: true,
    }
  );

  const TOK_RES_INACTIVE_WITH_PKG = 'portal_tok_inactive_with_pkg_12345678';
  const TOK_RES_INACTIVE_NO_PKG = 'portal_tok_inactive_no_pkg_87654321';
  db.tables.resident_access_tokens.push(
    {
      id: crypto.randomUUID(),
      resident_id: RES_INACTIVE_WITH_PKG_ID,
      condominium_id: CONDO_A,
      token: TOK_RES_INACTIVE_WITH_PKG,
      active: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      resident_id: RES_INACTIVE_NO_PKG_ID,
      condominium_id: CONDO_A,
      token: TOK_RES_INACTIVE_NO_PKG,
      active: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    }
  );

  const PKG_INACTIVE_RES_TOKEN = 'pkg_tok_clara_inactive_1234567890';
  const PKG_CARLOS_ID = crypto.randomUUID();
  const PKG_BETA_ID = crypto.randomUUID();

  db.tables.packages.push(
    {
      id: crypto.randomUUID(),
      condominium_id: CONDO_A,
      recipient_id: RES_INACTIVE_WITH_PKG_ID,
      unit_number: '204',
      unit_type: 'Casa',
      block: 'Torre Sul',
      carrier: 'Mercado Livre',
      status: 'received',
      pickup_code: '204999',
      pickup_token: PKG_INACTIVE_RES_TOKEN,
      received_at: new Date().toISOString(),
    },
    {
      id: PKG_CARLOS_ID,
      condominium_id: CONDO_A,
      recipient_id: RESIDENT_USER_ID,
      unit_number: '305',
      unit_type: 'Apartamento',
      block: 'Bloco B',
      carrier: 'Shopee',
      status: 'received',
      pickup_code: '4829',
      pickup_token: 'pkg_tok_carlos_legacy_1234567890',
      received_at: new Date().toISOString(),
    },
    {
      id: PKG_BETA_ID,
      condominium_id: CONDO_B,
      recipient_id: null,
      unit_number: '100',
      status: 'received',
      pickup_code: '778899',
      pickup_token: 'pkg_tok_beta_isolated_1234567890',
      received_at: new Date().toISOString(),
    }
  );

  const clientMock = db.createClient();
  const app = createApp({ supabase: clientMock, supabaseAdmin: clientMock, isProduction: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  try {
    console.log('\n=== INICIANDO SUITE DE HOMOLOGAÇÃO DAS CORREÇÕES DE REGRESSÃO ===\n');

    // 1. Portal serialization (unit_type, block, bloco) & inactive resident conditional allowance
    const portalValidateWithPkg = await requestJson(port, 'GET', `/api/portal/validate/${TOK_RES_INACTIVE_WITH_PKG}`);
    const portalValidateNoPkg = await requestJson(port, 'GET', `/api/portal/validate/${TOK_RES_INACTIVE_NO_PKG}`);
    const portalCodeWithPkg = await requestJson(port, 'GET', '/api/portal/validate-code/204999', undefined, {
      'X-Forwarded-For': '198.51.100.10',
    });
    const portalPkgWithInactiveRes = await requestJson(port, 'GET', `/api/portal/package/${PKG_INACTIVE_RES_TOKEN}`, undefined, {
      'X-Forwarded-For': '198.51.100.11',
    });

    assert(
      portalValidateWithPkg.status === 200 &&
        portalValidateWithPkg.data?.resident?.unit_type === 'Casa' &&
        portalValidateWithPkg.data?.resident?.block === 'Torre Sul' &&
        portalValidateWithPkg.data?.resident?.bloco === 'Torre Sul' &&
        portalValidateNoPkg.status === 404 &&
        portalCodeWithPkg.status === 200 &&
        portalCodeWithPkg.data?.resident?.unit_type === 'Casa' &&
        portalPkgWithInactiveRes.status === 200 &&
        portalPkgWithInactiveRes.data?.resident?.block === 'Torre Sul' &&
        portalPkgWithInactiveRes.data?.package?.unit_type === 'Casa',
      '1. Portal serializa unit_type/block/bloco e permite morador inativo apenas com encomenda pendente (404 caso contrário)'
    );

    // 2. Legacy short pickup code (4-8 chars) 2FA flow + GET /api/portal/my-packages
    const legacyChallenge = await requestJson(port, 'GET', '/api/portal/package/4829', undefined, {
      'X-Forwarded-For': '198.51.100.12',
    });
    const legacyNotFound = await requestJson(port, 'GET', '/api/portal/package/9999', undefined, {
      'X-Forwarded-For': '198.51.100.12',
    });
    const legacyWrongFactor = await requestJson(
      port,
      'POST',
      '/api/portal/verify-legacy-code',
      { code: '4829', verifier: '999' },
      { 'X-Forwarded-For': '198.51.100.12' }
    );
    const legacyRightUnit = await requestJson(
      port,
      'POST',
      '/api/portal/verify-legacy-code',
      { code: '4829', verifier: 'Apto 305' },
      { 'X-Forwarded-For': '198.51.100.13' }
    );
    const legacyRightPhone = await requestJson(
      port,
      'POST',
      '/api/portal/verify-legacy-code',
      { code: '4829', verifier: '6655' },
      { 'X-Forwarded-For': '198.51.100.14' }
    );
    const myPkgsAnon = await requestJson(port, 'GET', '/api/portal/my-packages');
    const myPkgsResident = await requestJson(port, 'GET', '/api/portal/my-packages', undefined, {
      Authorization: `Bearer ${TOKEN_RESIDENT_USER}`,
    });

    const challengeStr = JSON.stringify(legacyChallenge.data || {});
    assert(
      legacyChallenge.status === 200 &&
        legacyChallenge.data?.requiresVerification === true &&
        legacyChallenge.data?.condominium?.name === 'Condomínio Aurora' &&
        !challengeStr.includes('Carlos') &&
        !challengeStr.includes('988776655') &&
        legacyNotFound.status === 404 &&
        legacyWrongFactor.status === 403 &&
        legacyRightUnit.status === 200 &&
        legacyRightUnit.data?.valid === true &&
        legacyRightUnit.data?.resident?.unit_type === 'Apartamento' &&
        legacyRightPhone.status === 200 &&
        legacyRightPhone.data?.valid === true &&
        myPkgsAnon.status === 401 &&
        myPkgsResident.status === 200 &&
        Array.isArray(myPkgsResident.data?.packages) &&
        myPkgsResident.data.packages.some((p: any) => p.id === PKG_CARLOS_ID),
      '2. Código curto legado exige 2o fator (unidade ou últimos 4 dígitos), não vaza PII e /api/portal/my-packages funciona com JWT do morador'
    );

    // 3. Rate limits calibrated (35 validate-code calls allowed before 41st triggers 429; 55 OCR calls allowed before 61st triggers 429)
    let codeOkBeforeLimit = true;
    let codeHit429At = 0;
    for (let i = 1; i <= 45; i++) {
      const r = await requestJson(port, 'GET', '/api/portal/validate-code/000000', undefined, {
        'X-Forwarded-For': '198.51.100.77',
      });
      if (i <= 35 && r.status === 429) codeOkBeforeLimit = false;
      if (r.status === 429) {
        codeHit429At = i;
        break;
      }
    }

    let ocrOkBeforeLimit = true;
    let ocrHit429At = 0;
    for (let i = 1; i <= 65; i++) {
      const r = await requestJson(
        port,
        'POST',
        '/api/ocr/extract-basic',
        {},
        { Authorization: `Bearer ${TOKEN_PORTARIA_A}`, 'X-Forwarded-For': '198.51.100.78' }
      );
      if (i <= 55 && r.status === 429) ocrOkBeforeLimit = false;
      if (r.status === 429) {
        ocrHit429At = i;
        break;
      }
    }

    assert(
      codeOkBeforeLimit && codeHit429At === 41 && ocrOkBeforeLimit && ocrHit429At === 61,
      `3. Rate limits calibrados sem falsos positivos: validate-code limitou em ${codeHit429At} (>=41) e OCR limitou em ${ocrHit429At} (>=61)`
    );

    // 4. Full Portaria workflow with ONLY encomendas_portaria_token (zero Supabase Auth JWT)
    const portariaHeaders = { Authorization: `Bearer ${TOKEN_PORTARIA_A}` };

    const ctxRes = await requestJson(port, 'GET', '/api/operational/context', undefined, portariaHeaders);
    const createResidentRes = await requestJson(
      port,
      'POST',
      '/api/operational/moradores',
      {
        nome: 'Fernanda Lima',
        unidade: '402',
        unit_type: 'Apartamento',
        block: 'Bloco A',
        bloco: 'Bloco A',
        telefone: '5511977665544',
      },
      portariaHeaders
    );
    const createdResidentId = createResidentRes.data?.morador?.id;

    const patchResidentRes = await requestJson(
      port,
      'PATCH',
      `/api/operational/moradores/${createdResidentId}`,
      { telefone: '5511977660000' },
      portariaHeaders
    );

    const batchRes = await requestJson(
      port,
      'POST',
      '/api/operational/moradores/batch',
      {
        inserts: [{ nome: 'Lucas Lote', unidade: '501', telefone: '5511966554433' }],
        updates: [{ id: createdResidentId, observacoes: 'Atualizado via lote' }],
      },
      portariaHeaders
    );

    const uploadRes = await requestJson(
      port,
      'POST',
      '/api/operational/upload-photo',
      { imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', folder: 'package-photos' },
      portariaHeaders
    );

    // Create first package and then second package for Fernanda (verifying existingPendingPackages grouping)
    const pkg1Res = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: createdResidentId,
        packages: [
          {
            unit_number: '402',
            carrier: 'Amazon',
            pickup_code: '402111',
            pickup_token: 'pkg_tok_fernanda_1_abcdef123456',
            photo_url: uploadRes.data?.publicUrl,
          },
        ],
      },
      portariaHeaders
    );
    const pkg2Res = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: createdResidentId,
        packages: [
          {
            unit_number: '402',
            carrier: 'Correios',
            pickup_code: '402222',
            pickup_token: 'pkg_tok_fernanda_2_abcdef123456',
          },
        ],
      },
      portariaHeaders
    );
    const fernandaPkg1Id = pkg1Res.data?.packages?.[0]?.id;

    const waStatusRes = await requestJson(
      port,
      'POST',
      '/api/operational/packages/whatsapp-status',
      {
        packageIds: [fernandaPkg1Id],
        fields: { whatsapp_notified: true, whatsapp_sent: true, whatsapp_status: 'sent' },
      },
      portariaHeaders
    );

    const msgLogRes = await requestJson(
      port,
      'POST',
      '/api/operational/message-logs',
      { telefone: '5511977660000', mensagem: 'Encomenda disponível', status: 'sent' },
      portariaHeaders
    );

    const auditPostRes = await requestJson(
      port,
      'POST',
      '/api/operational/audit',
      { tipo_evento: 'ENVIO_WHATSAPP_MANUAL', acao: 'NOTIFY', registro_id: fernandaPkg1Id, descricao: 'Teste portaria' },
      portariaHeaders
    );

    const listPkgsRes = await requestJson(port, 'GET', '/api/operational/packages?status=pending&limit=500', undefined, portariaHeaders);

    const deliverRes = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: fernandaPkg1Id,
        deliveryMethod: 'foto',
        deliveredToName: 'Fernanda Lima',
        photoBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      },
      portariaHeaders
    );

    const dashRes = await requestJson(port, 'GET', '/api/operational/dashboard', undefined, portariaHeaders);

    assert(
      ctxRes.status === 200 &&
        ctxRes.data?.condominium?.id === CONDO_A &&
        ctxRes.data?.settings?.portaria_access_code === undefined &&
        createResidentRes.status === 200 &&
        Boolean(createdResidentId) &&
        patchResidentRes.status === 200 &&
        patchResidentRes.data?.morador?.telefone === '5511977660000' &&
        batchRes.status === 200 &&
        batchRes.data?.insertedCount === 1 &&
        batchRes.data?.updatedCount === 1 &&
        uploadRes.status === 200 &&
        Boolean(uploadRes.data?.publicUrl) &&
        pkg1Res.status === 200 &&
        pkg2Res.status === 200 &&
        Array.isArray(pkg2Res.data?.existingPendingPackages) &&
        pkg2Res.data.existingPendingPackages.some((p: any) => p.id === fernandaPkg1Id) &&
        waStatusRes.status === 200 &&
        msgLogRes.status === 200 &&
        auditPostRes.status === 200 &&
        listPkgsRes.status === 200 &&
        Array.isArray(listPkgsRes.data?.packages) &&
        deliverRes.status === 200 &&
        Boolean(deliverRes.data?.delivery_photo_url) &&
        dashRes.status === 200 &&
        dashRes.data?.counts?.delivered >= 1,
      '4. Fluxo completo da Portaria autenticado apenas com token de portaria (sem JWT Supabase Auth) funciona ponta a ponta'
    );

    // 5. Cross-tenant isolation & RBAC on /api/operational/*
    const crossCondoCtx = await requestJson(
      port,
      'GET',
      `/api/operational/context?condominiumId=${CONDO_B}`,
      undefined,
      portariaHeaders
    );
    const crossCondoDeliver = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      { packageId: PKG_BETA_ID },
      portariaHeaders
    );
    const portariaAuditGet = await requestJson(port, 'GET', '/api/operational/audit', undefined, portariaHeaders);
    const portariaSettingsPut = await requestJson(
      port,
      'PUT',
      '/api/operational/condominium-settings',
      { settings: { notification_template: 'Hack' } },
      portariaHeaders
    );
    const portariaClear = await requestJson(
      port,
      'POST',
      '/api/operational/packages/clear',
      { mode: 'test' },
      portariaHeaders
    );
    const portariaDeletePkg = await requestJson(
      port,
      'DELETE',
      `/api/operational/packages/${PKG_CARLOS_ID}`,
      undefined,
      portariaHeaders
    );
    const sindicoDeleteCrossPkg = await requestJson(
      port,
      'DELETE',
      `/api/operational/packages/${PKG_BETA_ID}`,
      undefined,
      { Authorization: `Bearer ${TOKEN_SINDICO}` }
    );

    // Create disposable package in CONDO_A to test authorized Síndico delete
    const disposablePkgId = crypto.randomUUID();
    db.tables.packages.push({
      id: disposablePkgId,
      condominium_id: CONDO_A,
      recipient_id: RESIDENT_USER_ID,
      unit_number: '305',
      status: 'received',
      pickup_code: '305000',
      pickup_token: 'pkg_tok_disposable_1234567890',
      received_at: new Date().toISOString(),
    });
    const sindicoDeleteOwnPkg = await requestJson(
      port,
      'DELETE',
      `/api/operational/packages/${disposablePkgId}`,
      undefined,
      { Authorization: `Bearer ${TOKEN_SINDICO}` }
    );

    assert(
      crossCondoCtx.status === 403 &&
        crossCondoDeliver.status === 403 &&
        portariaAuditGet.status === 403 &&
        portariaSettingsPut.status === 403 &&
        portariaClear.status === 403 &&
        portariaDeletePkg.status === 403 &&
        sindicoDeleteCrossPkg.status === 403 &&
        sindicoDeleteOwnPkg.status === 200 &&
        !db.tables.packages.some((p) => p.id === disposablePkgId),
      '5. Isolamento multi-tenant (403) e RBAC estrito aplicados em /api/operational/* (Portaria bloqueada, Síndico/Admin autorizados no próprio condomínio)'
    );

    // 6. Strict batch recipient validation & condominium isolation on POST /api/packages/create
    const tinyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pkgCountBeforeBatchTests = db.tables.packages.length;
    const uploadsBeforeBatchTests = db.uploadCount;
    const writesBeforeBatchTests = db.packageWriteCount;

    // 6a. Unauthenticated / invalid operational token -> 401, zero writes
    const unauthBatchCreate = await requestJson(port, 'POST', '/api/packages/create', {
      condominiumId: CONDO_A,
      recipientId: RESIDENT_USER_ID,
      packages: [{ unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 }],
    });
    const badTokenBatchCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [{ unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 }],
      },
      { Authorization: 'Bearer invalid_portaria_token_xyz' }
    );

    // 6b. Portaria Condo A trying to send recipient from Condo B -> 403, zero writes/uploads
    const crossCondoRecipientCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_B_ID,
        packages: [{ recipient_id: RESIDENT_B_ID, unit_number: '101', carrier: 'Shopee', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );

    const adminHeaders = { Authorization: `Bearer ${TOKEN_ADMIN}` };

    // 6c. Mixed batch (item 1 Condo A with photo_url, item 2 Condo B) -> 403, zero partial saves, zero uploads
    const mixedCrossCondoBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [
          { recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
          { recipient_id: RESIDENT_B_ID, unit_number: '101', carrier: 'Mercado Livre', photo_url: tinyPngBase64 },
        ],
      },
      adminHeaders
    );

    // 6d. Mixed distinct valid recipients in same condo -> 400, zero partial saves, zero uploads
    const mixedSameCondoRecipientsBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [
          { recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
          { recipient_id: RESIDENT_A2_ID, unit_number: '402', carrier: 'Amazon', photo_url: tinyPngBase64 },
        ],
      },
      adminHeaders
    );

    // 6e. Nonexistent recipient in batch -> 404, zero partial saves, zero uploads
    const nonexistentRecipientBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [
          { recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
          { recipient_id: '99999999-9999-4999-8999-999999999999', unit_number: '999', carrier: 'Correios' },
        ],
      },
      adminHeaders
    );

    // 6f. Body condominiumId / condominium_id / item condominium_id manipulation by Condo A Portaria -> 403, zero writes/uploads
    const spoofTopCondoId = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_B,
        recipientId: RESIDENT_USER_ID,
        packages: [{ recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Jadlog', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );
    const spoofSnakeCondoId = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominium_id: CONDO_B,
        recipientId: RESIDENT_USER_ID,
        packages: [{ recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Jadlog', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );
    const spoofItemCondoId = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [{ condominium_id: CONDO_B, recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Jadlog', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );

    const zeroMutationOnRejectedBatches =
      db.tables.packages.length === pkgCountBeforeBatchTests &&
      db.uploadCount === uploadsBeforeBatchTests &&
      db.packageWriteCount === writesBeforeBatchTests &&
      !db.tables.packages.some((p) => p.condominium_id === CONDO_B && p.recipient_id === RESIDENT_B_ID);

    // 6g. Valid multi-item batch for Condo A resident by Admin (ADICIONAR VÁRIAS) -> 200
    const validMultiItemBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          {
            recipient_id: RESIDENT_USER_ID,
            unit_number: '305',
            carrier: 'Amazon',
            notes: 'Lote Vol 1',
            photo_url: tinyPngBase64,
          },
          {
            unit_number: '305',
            carrier: 'Amazon',
            notes: 'Lote Vol 2',
          },
        ],
      },
      adminHeaders
    );

    const insertedBatchItems = Array.isArray(validMultiItemBatch.data?.packages) ? validMultiItemBatch.data.packages : [];
    assert(
      unauthBatchCreate.status === 401 &&
        badTokenBatchCreate.status === 401 &&
        crossCondoRecipientCreate.status === 403 &&
        mixedCrossCondoBatch.status === 403 &&
        mixedSameCondoRecipientsBatch.status === 400 &&
        nonexistentRecipientBatch.status === 404 &&
        spoofTopCondoId.status === 403 &&
        spoofSnakeCondoId.status === 403 &&
        spoofItemCondoId.status === 403 &&
        zeroMutationOnRejectedBatches &&
        validMultiItemBatch.status === 200 &&
        insertedBatchItems.length === 2 &&
        insertedBatchItems.every((p: any) => p.condominium_id === CONDO_A && p.recipient_id === RESIDENT_USER_ID) &&
        db.uploadCount === uploadsBeforeBatchTests + 1,
      '6. POST /api/packages/create valida todos os destinatários e condomínio do lote antes de upload/gravação (zero escrita parcial em rejeições; lote válido aprovado)'
    );

    // 7. Condominium identifier conflict validation in POST /api/packages/create
    const pkgCountBeforeCondoConflict = db.tables.packages.length;
    const uploadsBeforeCondoConflict = db.uploadCount;
    const writesBeforeCondoConflict = db.packageWriteCount;

    // 7a. Both condominiumId and condominium_id correct -> 200
    const bothCondoIdsMatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        condominium_id: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [{ condominium_id: CONDO_A, unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );
    const uploadsAfterMatch = db.uploadCount;
    const writesAfterMatch = db.packageWriteCount;
    const pkgCountAfterMatch = db.tables.packages.length;

    // 7b. condominiumId correct + condominium_id divergent -> 403, zero uploads/writes
    const camelOkSnakeBad = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        condominium_id: CONDO_B,
        recipientId: RESIDENT_USER_ID,
        packages: [{ unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );

    // 7c. condominiumId divergent + condominium_id correct -> 403, zero uploads/writes
    const camelBadSnakeOk = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_B,
        condominium_id: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [{ unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 }],
      },
      portariaHeaders
    );

    // 7d. Top-level identifiers correct + packages[1].condominium_id divergent -> 403, zero uploads/writes
    const topOkItemDivergent = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        condominium_id: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [
          { condominium_id: CONDO_A, unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 },
          { condominium_id: CONDO_B, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
        ],
      },
      adminHeaders
    );

    // 7e. Multiple items with conflicting condominium identifiers (snake_case & camelCase) -> 403, zero uploads/writes
    const multiItemConflictingCondo = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [
          { condominium_id: CONDO_B, unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 },
          { condominiumId: CONDO_B, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
        ],
      },
      adminHeaders
    );

    // 7f. Global admin sending conflicting condominiumId vs condominium_id simultaneously -> 403, zero uploads/writes
    const adminConflictingCondo = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        condominium_id: CONDO_B,
        recipientId: RESIDENT_USER_ID,
        packages: [{ unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 }],
      },
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );

    assert(
      bothCondoIdsMatch.status === 200 &&
        uploadsAfterMatch === uploadsBeforeCondoConflict + 1 &&
        pkgCountAfterMatch === pkgCountBeforeCondoConflict + 1 &&
        writesAfterMatch > writesBeforeCondoConflict &&
        camelOkSnakeBad.status === 403 &&
        camelBadSnakeOk.status === 403 &&
        topOkItemDivergent.status === 403 &&
        multiItemConflictingCondo.status === 403 &&
        adminConflictingCondo.status === 403 &&
        db.uploadCount === uploadsAfterMatch &&
        db.packageWriteCount === writesAfterMatch &&
        db.tables.packages.length === pkgCountAfterMatch,
      '7. POST /api/packages/create valida todos os identificadores de condomínio sem sombreamento (403 em qualquer conflito, zero uploads/gravações)'
    );

    // 8. Full photo pre-validation (format + 5MB limit) BEFORE any Storage upload or DB write
    const tinyJpegBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const oversizedJpegBase64 = `data:image/jpeg;base64,${Buffer.alloc(5 * 1024 * 1024 + 1024, 0xff).toString('base64')}`;

    const uploadsBeforePhotoTests = db.uploadCount;
    const writesBeforePhotoTests = db.packageWriteCount;
    const pkgCountBeforePhotoTests = db.tables.packages.length;

    // 8a. First item valid photo + second item invalid MIME/format -> 400 BEFORE any upload (uploadCount delta = 0)
    const firstValidSecondBadFormat = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 },
          { unit_number: '305', carrier: 'Shopee', photo_url: 'data:image/svg+xml;base64,PHN2Zy8+' },
        ],
      },
      adminHeaders
    );

    // 8b. First item valid photo + second item non-data invalid string -> 400 BEFORE any upload
    const firstValidSecondArbitraryStr = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 },
          { unit_number: '305', carrier: 'Shopee', photo_url: 'invalid-photo-string' },
        ],
      },
      adminHeaders
    );

    // 8c. First item valid photo + second item above 5MB limit -> 400 BEFORE any upload
    const firstValidSecondOversized = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 },
          { unit_number: '305', carrier: 'Shopee', photo_url: oversizedJpegBase64 },
        ],
      },
      adminHeaders
    );

    // 8d. Invalid photo on first item -> 400, zero uploads
    const firstItemInvalidPhoto = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Amazon', photo_url: 'data:text/plain;base64,SGVsbG8=' },
          { unit_number: '305', carrier: 'Shopee', photo_url: tinyJpegBase64 },
        ],
      },
      adminHeaders
    );

    // 8e. Invalid base64 photo on last item -> 400, zero uploads
    const lastItemInvalidBase64 = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Amazon', photo_url: tinyPngBase64 },
          { unit_number: '305', carrier: 'Shopee', photo_url: tinyJpegBase64 },
          { unit_number: '305', carrier: 'Correios', photo_url: 'data:image/jpeg;base64,!!!invalid!!!' },
        ],
      },
      adminHeaders
    );

    const zeroWritesAndUploadsOnBadPhotos =
      db.uploadCount === uploadsBeforePhotoTests &&
      db.packageWriteCount === writesBeforePhotoTests &&
      db.tables.packages.length === pkgCountBeforePhotoTests;

    // 8f. Valid batch with multiple valid photos (PNG + JPEG) -> 200, 2 uploads
    const validMultiPhotoBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Amazon', notes: 'Foto PNG', photo_url: tinyPngBase64 },
          { unit_number: '305', carrier: 'Shopee', notes: 'Foto JPEG', photo_url: tinyJpegBase64 },
        ],
      },
      adminHeaders
    );

    // 8g. Valid batch without photos -> 200, 0 additional uploads
    const uploadsAfterMultiPhoto = db.uploadCount;
    const validNoPhotoBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { unit_number: '305', carrier: 'Correios', notes: 'Sem foto 1' },
          { unit_number: '305', carrier: 'Jadlog', notes: 'Sem foto 2' },
        ],
      },
      adminHeaders
    );

    assert(
      firstValidSecondBadFormat.status === 400 &&
        firstValidSecondArbitraryStr.status === 400 &&
        firstValidSecondOversized.status === 400 &&
        firstItemInvalidPhoto.status === 400 &&
        lastItemInvalidBase64.status === 400 &&
        zeroWritesAndUploadsOnBadPhotos &&
        validMultiPhotoBatch.status === 200 &&
        Array.isArray(validMultiPhotoBatch.data?.packages) &&
        validMultiPhotoBatch.data.packages.length === 2 &&
        uploadsAfterMultiPhoto === uploadsBeforePhotoTests + 2 &&
        validNoPhotoBatch.status === 200 &&
        Array.isArray(validNoPhotoBatch.data?.packages) &&
        validNoPhotoBatch.data.packages.length === 2 &&
        db.uploadCount === uploadsAfterMultiPhoto,
      '8. POST /api/packages/create pré-valida todas as fotos (formato JPEG/PNG e limite 5MB) antes de qualquer upload ou gravação'
    );

    // 11. ONDA 1: Dashboard real volume count (>1,000 rows + [QTD: X] + historical + undated + zero select('*'))
    const CONDO_WAVE1 = '30303030-3030-4030-8030-303030303030';
    db.tables.condominiums.push({
      id: CONDO_WAVE1,
      name: 'Condomínio Horizonte',
      address: 'Av. Horizonte, 1000',
      active: true,
    });

    const wave1Seed: Row[] = [];
    // 590 delivered normal rows (100 historical 2024 + 490 recent 2026) -> 590 vols
    for (let i = 0; i < 590; i++) {
      wave1Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE1,
        status: 'delivered',
        notes: 'Entrega normal',
        received_at: i < 100 ? '2024-02-15T10:00:00.000Z' : '2026-10-10T12:00:00.000Z',
        delivered_at: '2026-10-11T12:00:00.000Z',
        photo_url: 'https://mock-storage.local/packages/huge-image.jpg',
      });
    }
    // 5 delivered rows with [QTD: 5] -> 25 vols
    for (let i = 0; i < 5; i++) {
      wave1Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE1,
        status: 'delivered',
        notes: '[QTD: 5] Lote de 5 encomendas',
        received_at: '2026-10-12T12:00:00.000Z',
        delivered_at: '2026-10-13T12:00:00.000Z',
      });
    }
    // 5 delivered rows with legacy "Lote de 3 encomendas" -> 15 vols
    for (let i = 0; i < 5; i++) {
      wave1Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE1,
        status: 'delivered',
        notes: 'Lote de 3 encomendas',
        received_at: '2026-10-14T12:00:00.000Z',
        delivered_at: '2026-10-15T12:00:00.000Z',
      });
    }
    // 630 pending normal rows (10 undated + 620 dated) -> 630 vols
    for (let i = 0; i < 630; i++) {
      wave1Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE1,
        status: 'received',
        notes: '',
        received_at: i < 10 ? null : '2026-11-01T14:00:00.000Z',
        delivered_at: null,
      });
    }
    // 15 pending rows with [QTD: 4] -> 60 vols
    for (let i = 0; i < 15; i++) {
      wave1Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE1,
        status: 'received',
        notes: 'Caixa grande, [QTD: 4] Lote de 4 encomendas',
        received_at: '2026-11-10T10:00:00.000Z',
        delivered_at: null,
      });
    }
    // 5 pending rows with [QTD: 10] -> 50 vols
    for (let i = 0; i < 5; i++) {
      wave1Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE1,
        status: 'received',
        notes: '[QTD: 10] Lote de 10 encomendas',
        received_at: '2026-11-15T18:00:00.000Z',
        delivered_at: null,
      });
    }
    db.tables.packages.push(...wave1Seed);

    const logCountBeforeDash = db.packageSelectLogs.length;
    const wave1DashRes = await requestJson(
      port,
      'GET',
      `/api/operational/dashboard?condominiumId=${CONDO_WAVE1}`,
      undefined,
      adminHeaders
    );
    const wave1SelectLogs = db.packageSelectLogs.slice(logCountBeforeDash);

    // Tenant isolation check: Condo B dashboard cannot include CONDO_WAVE1 rows, and Condo A portaria cannot read CONDO_WAVE1
    const condoBDashRes = await requestJson(
      port,
      'GET',
      `/api/operational/dashboard?condominiumId=${CONDO_B}`,
      undefined,
      adminHeaders
    );
    const portariaWave1CrossBlock = await requestJson(
      port,
      'GET',
      `/api/operational/dashboard?condominiumId=${CONDO_WAVE1}`,
      undefined,
      portariaHeaders
    );

    assert(
      wave1DashRes.status === 200 &&
        wave1DashRes.data?.counts?.all === 1250 &&
        wave1DashRes.data?.counts?.delivered === 600 &&
        wave1DashRes.data?.counts?.pending === 650 &&
        wave1DashRes.data?.stats?.total === 1370 &&
        wave1DashRes.data?.stats?.delivered === 630 &&
        wave1DashRes.data?.stats?.pending === 740 &&
        wave1DashRes.data?.undatedPackagesCount === 10 &&
        wave1DashRes.data?.periodRange?.start === '2024-02-15T10:00:00.000Z' &&
        wave1DashRes.data?.periodRange?.end === '2026-11-15T18:00:00.000Z' &&
        wave1SelectLogs.length >= 2 &&
        wave1SelectLogs.every(
          (l) =>
            l.select !== '*' &&
            !l.select.includes('photo_url') &&
            !l.select.includes('whatsapp_message') &&
            l.rangeStart !== null &&
            l.rangeEnd !== null
        ) &&
        condoBDashRes.status === 200 &&
        (condoBDashRes.data?.stats?.total || 0) < 100 &&
        portariaWave1CrossBlock.status === 403,
      '11. Onda 1: Dashboard pagina acima de 1.000 registros sem select(*) e soma corretamente [QTD: X], histórico e período com isolamento'
    );

    // 12. ONDA 1: Block ADICIONAR VÁRIAS (packages.length > 1) for Porteiro/Portaria/Síndico while preserving Admin & QUANTIDADE DE ENCOMENDAS
    const uploadsBeforeWave1Role = db.uploadCount;
    const writesBeforeWave1Role = db.packageWriteCount;
    const pkgCountBeforeWave1Role = db.tables.packages.length;

    const batchPayloadCondoA = {
      condominiumId: CONDO_A,
      recipientId: RESIDENT_USER_ID,
      packages: [
        { unit_number: '305', carrier: 'Amazon', notes: 'Vol 1', photo_url: tinyPngBase64 },
        { unit_number: '305', carrier: 'Amazon', notes: 'Vol 2', photo_url: tinyJpegBase64 },
      ],
    };

    const portariaMultiBlocked = await requestJson(port, 'POST', '/api/packages/create', batchPayloadCondoA, portariaHeaders);
    const porteiroMultiBlocked = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      batchPayloadCondoA,
      { Authorization: `Bearer ${TOKEN_PORTEIRO_A}` }
    );
    const sindicoMultiBlocked = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      batchPayloadCondoA,
      { Authorization: `Bearer ${TOKEN_SINDICO}` }
    );

    const zeroSideEffectsOnBlockedBatch =
      db.uploadCount === uploadsBeforeWave1Role &&
      db.packageWriteCount === writesBeforeWave1Role &&
      db.tables.packages.length === pkgCountBeforeWave1Role;

    // QUANTIDADE DE ENCOMENDAS (1 DB row with [QTD: 5]) MUST still succeed for Portaria & Porteiro
    const qtdTokenPortaria = `tok_wave1_qtd_port_${crypto.randomBytes(6).toString('hex')}`;
    const portariaQtdAllowed = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_A2_ID,
        packages: [
          {
            unit_number: '402',
            carrier: 'Shopee',
            notes: '[QTD: 5] Lote de 5 encomendas',
            pickup_code: '402999',
            pickup_token: qtdTokenPortaria,
            photo_url: tinyPngBase64,
          },
        ],
      },
      portariaHeaders
    );
    const porteiroQtdAllowed = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_A2_ID,
        packages: [
          {
            unit_number: '402',
            carrier: 'Mercado Livre',
            notes: '[QTD: 3] Lote de 3 encomendas',
          },
        ],
      },
      { Authorization: `Bearer ${TOKEN_PORTEIRO_A}` }
    );

    // Verify public page still counts [QTD: X] volumes accurately
    const qtdEffectiveToken = portariaQtdAllowed.data?.packages?.[0]?.pickup_token;
    const portalQtdCheck = await requestJson(port, 'GET', `/api/portal/package/${qtdEffectiveToken}`);

    // Admin ADICIONAR VÁRIAS (packages.length > 1) MUST remain preserved
    const adminMultiAllowed = await requestJson(port, 'POST', '/api/packages/create', batchPayloadCondoA, adminHeaders);

    // Verify UI guard alignment in PackageNew.tsx (neither rendered nor usable by non-admin)
    const packageNewSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PackageNew.tsx'), 'utf8');
    const adicionarVariasSectionIdx = packageNewSource.lastIndexOf('ADICIONAR VÁRIAS');
    const isRenderedOnlyForAdmin =
      adicionarVariasSectionIdx > 0 &&
      packageNewSource.slice(Math.max(0, adicionarVariasSectionIdx - 1000), adicionarVariasSectionIdx).includes('{isAdminUser && (');
    const hasNormalizedAdminGuardInPackageNew =
      packageNewSource.includes("normalizeRole(user?.role)") &&
      packageNewSource.includes("isAdminUser && isBatch && batchQuantity > 1") &&
      packageNewSource.includes("if (!isAdminUser && (isBatch || batchQuantity !== 1))") &&
      isRenderedOnlyForAdmin;

    const portalTotalVolumes = sumPackageItems(portalQtdCheck.data?.allPackages || []);

    assert(
      portariaMultiBlocked.status === 403 &&
        porteiroMultiBlocked.status === 403 &&
        sindicoMultiBlocked.status === 403 &&
        zeroSideEffectsOnBlockedBatch &&
        portariaQtdAllowed.status === 200 &&
        portariaQtdAllowed.data?.packages?.length === 1 &&
        porteiroQtdAllowed.status === 200 &&
        porteiroQtdAllowed.data?.packages?.length === 1 &&
        portalQtdCheck.status === 200 &&
        String(portalQtdCheck.data?.package?.notes || '').includes('[QTD: 5]') &&
        portalTotalVolumes >= 5 &&
        adminMultiAllowed.status === 200 &&
        adminMultiAllowed.data?.packages?.length === 2 &&
        hasNormalizedAdminGuardInPackageNew,
      '12. Onda 1: ADICIONAR VÁRIAS oculto e bloqueado para Porteiro/Portaria/Síndico (UI + API 403), Admin preservado e QUANTIDADE DE ENCOMENDAS ([QTD: X]) funcionando'
    );

    // 9. Condominium creation schema-column fallback + auto-binding unlinked admin + Admin deactivation revoking Portaria token
    db.simulateMissingCondoExtendedColumns = true;
    const createCondoFallback = await requestJson(
      port,
      'POST',
      '/api/condominiums/create',
      {
        name: 'Condomínio Fallback',
        address: 'Rua Teste, 50',
        city_state: 'São Paulo/SP',
        manager_name: 'Gestor Teste',
        internal_notes: 'Notas',
      },
      { Authorization: `Bearer ${TOKEN_UNLINKED_ADMIN}` }
    );
    db.simulateMissingCondoExtendedColumns = false;

    const unlinkedAdminAfter = db.tables.profiles.find((p) => p.id === UNLINKED_ADMIN_ID);

    const sindicoPutActiveFalse = await requestJson(
      port,
      'PUT',
      `/api/admin/condominiums/${CONDO_A}`,
      { name: 'Condomínio Aurora', address: 'Av. Aurora, 10', active: false },
      { Authorization: `Bearer ${TOKEN_SINDICO}` }
    );
    const adminPutActiveFalse = await requestJson(
      port,
      'PUT',
      `/api/admin/condominiums/${CONDO_A}`,
      { name: 'Condomínio Aurora', address: 'Av. Aurora, 10', active: false },
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );

    const settingsAAfterDeactivate = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A);
    const portariaAfterCondoBlocked = await requestJson(port, 'GET', '/api/operational/context', undefined, portariaHeaders);

    const fallbackCondoId = createCondoFallback.data?.condo?.id || createCondoFallback.data?.condominium?.id;
    assert(
      createCondoFallback.status === 200 &&
        Boolean(fallbackCondoId) &&
        unlinkedAdminAfter?.condominium_id === fallbackCondoId &&
        sindicoPutActiveFalse.status === 403 &&
        adminPutActiveFalse.status === 200 &&
        settingsAAfterDeactivate?.active_portaria_token === null &&
        portariaAfterCondoBlocked.status === 401,
      '9. POST /api/condominiums/create suporta fallback de schema e auto-vincula admin sem condomínio; PUT active=false é restrito a admin global e revoga token da portaria'
    );

    // 10. 48h/72h automatic reminders permanently deactivated
    const cronGet = await requestJson(port, 'GET', '/api/cron/reminders');
    const cronPost = await requestJson(port, 'POST', '/api/cron/reminders', {});
    const syndicPanelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SyndicPanel.tsx'), 'utf8');
    const has48or72Ui =
      syndicPanelSource.includes('reminder_48h_enabled') ||
      syndicPanelSource.includes('reminder_72h_enabled') ||
      syndicPanelSource.includes('lembrete automático após 48h') ||
      syndicPanelSource.includes('lembrete automático após 72h');

    assert(
      cronGet.status === 410 &&
        cronPost.status === 410 &&
        cronPost.data?.disabled === true &&
        cronPost.data?.sent === 0 &&
        !has48or72Ui,
      '10. Lembretes automáticos 48h/72h permanecem 100% desativados no backend (410) e removidos da interface (SyndicPanel.tsx)'
    );

    // 13. PAINEL DO SÍNDICO (>1.000 encomendas + >1.000 moradores): eliminação de truncamento, gráfico 7 dias, QR vs Manual e isolamento
    const CONDO_WAVE2 = '40404040-4040-4040-8040-404040404040';
    const TOKEN_PORTARIA_WAVE2 = 'portaria-wave2-secret-token';
    db.tables.condominiums.push({
      id: CONDO_WAVE2,
      name: 'Condomínio Metrópole',
      address: 'Av. Metrópole, 2000',
      active: true,
    });
    db.tables.condominium_settings.push({
      condominium_id: CONDO_WAVE2,
      active_portaria_token: TOKEN_PORTARIA_WAVE2,
      portaria_session_hours: 12,
      whatsapp_mode: 'manual',
    });

    const moradorIdsWave2: string[] = [];
    for (let i = 0; i < 1150; i++) {
      const mId = crypto.randomUUID();
      if (i < 1120) moradorIdsWave2.push(mId);
      db.tables.moradores.push({
        id: mId,
        condominium_id: CONDO_WAVE2,
        nome: `Morador Wave2 ${String(i + 1).padStart(4, '0')}`,
        unidade: `${100 + i}`,
        unit_type: 'Apartamento',
        telefone: '11999990000',
        ativo: i < 1120,
      });
    }

    const tzOffMin = new Date().getTimezoneOffset();
    const localDayIsoAtNoon = (daysAgo: number) => {
      const shiftedMidnight = new Date(Date.now() - tzOffMin * 60_000);
      shiftedMidnight.setUTCHours(12, 0, 0, 0);
      shiftedMidnight.setUTCDate(shiftedMidnight.getUTCDate() - daysAgo);
      return new Date(shiftedMidnight.getTime() + tzOffMin * 60_000).toISOString();
    };

    const todayNoonIso = localDayIsoAtNoon(0);
    const yesterdayNoonIso = localDayIsoAtNoon(1);
    const threeDaysAgoIso = localDayIsoAtNoon(3);
    const oldMonthIso = localDayIsoAtNoon(20);

    const wave2Seed: Row[] = [];
    // 1.150 registros no CONDO_WAVE2:
    // - 42 recebidas hoje (12 pendentes sendo 2 com [QTD: 3], 30 entregues hoje: 18 qr_code, 12 CÓDIGO)
    // - 30 recebidas ontem (10 pendentes, 20 entregues ontem via manual)
    // - 25 recebidas há 3 dias (5 pendentes, 20 entregues há 3 dias via qr_code)
    // - 1.053 antigas (20 dias atrás: 100 pendentes, 953 entregues antigas: 200 qr_code, 753 manual)
    for (let i = 0; i < 42; i++) {
      const isPending = i < 12;
      const isQr = !isPending && i < 30;
      wave2Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[i % moradorIdsWave2.length],
        unit_number: `${100 + (i % 100)}`,
        status: isPending ? 'received' : 'delivered',
        notes: isPending && i < 2 ? '[QTD: 3] Lote de 3 encomendas' : 'Hoje',
        received_at: todayNoonIso,
        delivered_at: isPending ? null : todayNoonIso,
        delivery_method: isPending ? null : (isQr ? 'qr_code' : 'CÓDIGO'),
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
      });
    }
    for (let i = 0; i < 30; i++) {
      const isPending = i < 10;
      wave2Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[(i + 50) % moradorIdsWave2.length],
        unit_number: `${200 + i}`,
        status: isPending ? 'received' : 'delivered',
        notes: 'Ontem',
        received_at: yesterdayNoonIso,
        delivered_at: isPending ? null : yesterdayNoonIso,
        delivery_method: isPending ? null : 'manual',
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
      });
    }
    for (let i = 0; i < 25; i++) {
      const isPending = i < 5;
      wave2Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[(i + 100) % moradorIdsWave2.length],
        unit_number: `${300 + i}`,
        status: isPending ? 'received' : 'delivered',
        notes: 'Há 3 dias',
        received_at: threeDaysAgoIso,
        delivered_at: isPending ? null : threeDaysAgoIso,
        delivery_method: isPending ? null : 'qr_code',
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
      });
    }
    for (let i = 0; i < 1053; i++) {
      const isPending = i < 100;
      const isQr = !isPending && i < 300;
      wave2Seed.push({
        id: crypto.randomUUID(),
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[(i + 200) % moradorIdsWave2.length],
        unit_number: `${400 + (i % 200)}`,
        status: isPending ? 'received' : 'delivered',
        notes: 'Histórico',
        received_at: oldMonthIso,
        delivered_at: isPending ? null : oldMonthIso,
        delivery_method: isPending ? null : (isQr ? 'qr_code' : 'manual'),
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
      });
    }
    db.tables.packages.push(...wave2Seed);

    const ctxWave2AllMoradores = await requestJson(
      port,
      'GET',
      `/api/operational/context?includeInactive=true&condominiumId=${CONDO_WAVE2}`,
      undefined,
      adminHeaders
    );
    const moradoresWave2ActiveOnly = await requestJson(
      port,
      'GET',
      `/api/operational/moradores?condominiumId=${CONDO_WAVE2}`,
      undefined,
      adminHeaders
    );
    const dashWave2 = await requestJson(
      port,
      'GET',
      `/api/operational/dashboard?condominiumId=${CONDO_WAVE2}&tzOffset=${tzOffMin}`,
      undefined,
      adminHeaders
    );

    const s2 = dashWave2.data?.syndicStats;
    const chartSumRecebidas = (s2?.chartData || []).reduce((acc: number, d: any) => acc + (d.recebidas || 0), 0);
    const chartSumRetiradas = (s2?.chartData || []).reduce((acc: number, d: any) => acc + (d.retiradas || 0), 0);
    const expectedPendingRows = 12 + 10 + 5 + 100; // 127
    const expectedQrRows = 18 + 20 + 200; // 238
    const expectedManualRows = 12 + 20 + 753; // 785
    const syndicPanelHasPagination =
      syndicPanelSource.includes('fetchAllOperationalPackages') &&
      syndicPanelSource.includes('syndicStats') &&
      !syndicPanelSource.includes('status=all&limit=1000');

    assert(
      ctxWave2AllMoradores.status === 200 &&
        ctxWave2AllMoradores.data?.moradores?.length === 1150 &&
        moradoresWave2ActiveOnly.status === 200 &&
        moradoresWave2ActiveOnly.data?.moradores?.length === 1120 &&
        dashWave2.status === 200 &&
        dashWave2.data?.counts?.all === 1150 &&
        dashWave2.data?.counts?.pending === expectedPendingRows &&
        dashWave2.data?.stats?.total === 1154 &&
        dashWave2.data?.stats?.pending === expectedPendingRows + 4 &&
        s2?.receivedToday === 42 &&
        s2?.deliveredToday === 30 &&
        s2?.qrRetrievals === expectedQrRows &&
        s2?.manualRetrievals === expectedManualRows &&
        s2?.residentsCount === 1120 &&
        Boolean(s2?.lastPackage?.id) &&
        chartSumRecebidas === 42 + 30 + 25 &&
        chartSumRetiradas === 30 + 20 + 20 &&
        syndicPanelHasPagination,
      '13. Painel do Síndico: elimina truncamento >1.000 em pacotes/moradores, totaliza recebidas/retiradas/QR/manual/gráfico 7 dias e preserva [QTD: X]'
    );

    // 14. QR CODE: Abertura automática da câmera traseira, digitação simultânea e guarda anti-duplicidade na entrega (concorrente & sequencial)
    const portariaWave2Headers = { Authorization: `Bearer ${TOKEN_PORTARIA_WAVE2}` };
    const dupTargetId = crypto.randomUUID();
    const dupSiblingId = crypto.randomUUID();
    const dupToken = `tok_dup_${crypto.randomBytes(6).toString('hex')}`;
    db.tables.packages.push(
      {
        id: dupTargetId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[0],
        unit_number: '100',
        status: 'received',
        pickup_code: '4455',
        pickup_token: dupToken,
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
        received_at: new Date().toISOString(),
        delivered_at: null,
      },
      {
        id: dupSiblingId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[0],
        unit_number: '100',
        status: 'received',
        pickup_code: '4455',
        pickup_token: dupToken,
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
        received_at: new Date().toISOString(),
        delivered_at: null,
      }
    );

    const logsBeforeConcurrent = db.tables.retrieval_logs.length;
    const [concurrent1, concurrent2] = await Promise.all([
      requestJson(
        port,
        'POST',
        '/api/operational/packages/deliver',
        {
          packageId: dupTargetId,
          packageIds: [dupTargetId, dupSiblingId],
          condominiumId: CONDO_WAVE2,
          pickupToken: dupToken,
          pickupCode: '4455',
          deliveryMethod: 'qr_code',
          deliveredToName: 'Morador (QR)',
          porterName: 'Porteiro Teste',
        },
        portariaWave2Headers
      ),
      requestJson(
        port,
        'POST',
        '/api/operational/packages/deliver',
        {
          packageId: dupTargetId,
          packageIds: [dupTargetId, dupSiblingId],
          condominiumId: CONDO_WAVE2,
          pickupToken: dupToken,
          pickupCode: '4455',
          deliveryMethod: 'qr_code',
          deliveredToName: 'Morador (QR)',
          porterName: 'Porteiro Teste',
        },
        portariaWave2Headers
      ),
    ]);

    const sequentialRepeat = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: dupTargetId,
        packageIds: [dupTargetId, dupSiblingId],
        condominiumId: CONDO_WAVE2,
        deliveryMethod: 'CÓDIGO',
        deliveredToName: 'Morador (Código)',
        porterName: 'Porteiro Teste',
      },
      portariaWave2Headers
    );

    const concurrentStatuses = [concurrent1.status, concurrent2.status].sort();
    const createdLogsForTarget = db.tables.retrieval_logs.slice(logsBeforeConcurrent);
    const portariaSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Portaria.tsx'), 'utf8');
    const hasAutoRearCamAndSimultaneousInput =
      portariaSource.includes('{ facingMode: "environment" }') &&
      portariaSource.includes('setCameraStarted(true);') &&
      portariaSource.includes('manualInputRef') &&
      !portariaSource.includes('ref={manualInputRef}\n                        autoFocus') &&
      portariaSource.includes('isProcessingScanRef') &&
      portariaSource.includes('isDeliveringRef') &&
      portariaSource.includes('setCameraError(');

    assert(
      concurrentStatuses[0] === 200 &&
        concurrentStatuses[1] === 409 &&
        sequentialRepeat.status === 409 &&
        sequentialRepeat.data?.alreadyDelivered === true &&
        createdLogsForTarget.length === 2 &&
        hasAutoRearCamAndSimultaneousInput,
      '14. QR Code: abertura automática da câmera traseira + digitação 4 dígitos simultânea e proteção atômica anti-duplicidade (409 em chamadas concorrentes/repetidas)'
    );

    // 15. CONSISTÊNCIA DO STATUS DE NOTIFICAÇÃO (sem falso "AVISAR MORADOR" após envio confirmado)
    const notifSingleId = crypto.randomUUID();
    const notifGroup1Id = crypto.randomUUID();
    const notifGroup2Id = crypto.randomUUID();
    const notifStatusOnlyId = crypto.randomUUID();
    const notifStillPendingId = crypto.randomUUID();

    db.tables.packages.push(
      {
        id: notifSingleId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[10],
        unit_number: '110',
        status: 'received',
        pickup_code: '6101',
        pickup_token: 'tok-notif-single',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: 'pending',
        received_at: new Date().toISOString(),
      },
      {
        id: notifGroup1Id,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[11],
        unit_number: '111',
        status: 'received',
        pickup_code: '6102',
        pickup_token: 'tok-notif-group',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: 'pending',
        received_at: new Date().toISOString(),
      },
      {
        id: notifGroup2Id,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[11],
        unit_number: '111',
        status: 'received',
        pickup_code: '6102',
        pickup_token: 'tok-notif-group',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: 'pending',
        received_at: new Date().toISOString(),
      },
      {
        id: notifStatusOnlyId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[12],
        unit_number: '112',
        status: 'received',
        pickup_code: '6103',
        pickup_token: 'tok-notif-statusonly',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: 'sent',
        received_at: new Date().toISOString(),
      },
      {
        id: notifStillPendingId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[13],
        unit_number: '113',
        status: 'received',
        pickup_code: '6104',
        pickup_token: 'tok-notif-pending',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: 'pending',
        received_at: new Date().toISOString(),
      }
    );

    const waConfirmRes = await requestJson(
      port,
      'POST',
      '/api/operational/packages/whatsapp-status',
      {
        condominiumId: CONDO_WAVE2,
        packageIds: [notifSingleId, notifGroup1Id, notifGroup2Id],
        fields: {
          whatsapp_notified: true,
          whatsapp_sent: true,
          whatsapp_status: 'enviado',
        },
      },
      portariaWave2Headers
    );

    const refreshedPendingWave2 = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=pending&offset=0&limit=1000&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );

    const subsetForCheck = (refreshedPendingWave2.data?.packages || []).filter((p: any) =>
      [notifSingleId, notifGroup1Id, notifGroup2Id, notifStatusOnlyId, notifStillPendingId].includes(p.id)
    );
    const groupedSampleConfirmed = {
      id: notifGroup1Id,
      isGroup: true,
      packages: subsetForCheck.filter((p: any) => p.id === notifGroup1Id || p.id === notifGroup2Id),
    };
    const groupedSampleMixed = {
      id: notifGroup1Id,
      isGroup: true,
      packages: [
        ...groupedSampleConfirmed.packages,
        subsetForCheck.find((p: any) => p.id === notifStillPendingId),
      ].filter(Boolean),
    };
    const needingNotificationSubset = getPackagesNeedingNotification(
      subsetForCheck,
      db.tables.moradores.filter((m) => m.condominium_id === CONDO_WAVE2),
      true
    );

    const packageListSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PackageList.tsx'), 'utf8');
    const modalsAndGuardsPreserved =
      portariaSource.includes('pendingWhatsAppConfirm') &&
      portariaSource.includes('fetchSeqRef') &&
      portariaSource.includes('recentlyConfirmedNotifiedRef') &&
      portariaSource.includes('isPackageNotificationConfirmed') &&
      packageNewSource.includes('isWaitingForReturn') &&
      packageNewSource.includes('allNotifiedPackageIds') &&
      packageListSource.includes('isPackageNotificationConfirmed');

    assert(
      waConfirmRes.status === 200 &&
        waConfirmRes.data?.data?.length === 3 &&
        isPackageNotificationConfirmed(subsetForCheck.find((p: any) => p.id === notifSingleId)) === true &&
        isPackageNotificationConfirmed(groupedSampleConfirmed) === true &&
        isPackageNotificationConfirmed(subsetForCheck.find((p: any) => p.id === notifStatusOnlyId)) === true &&
        isPackageNotificationConfirmed(groupedSampleMixed) === false &&
        needingNotificationSubset.length === 1 &&
        needingNotificationSubset[0]?.id === notifStillPendingId &&
        modalsAndGuardsPreserved,
      '15. Notificação: confirmação persiste em item único/lote/agrupamento, remove falso AVISAR MORADOR e preserva modais de confirmação e guardas contra overwrite'
    );

    // 16. E2E COMPLETO QR CODE: Notificação -> Link/Portal Morador -> QR JSON -> Reconhecimento prévio (sem re-prompt/botão) -> Baixa automática HTTP 200 -> Logs & Auditoria
    const qrResidentId = moradorIdsWave2[15];
    const qrE2eToken = `tok_qr_e2e_${crypto.randomBytes(6).toString('hex')}`;
    const qrE2eCode = '8392';
    const qrBatchToken = `tok_qr_batch_${crypto.randomBytes(6).toString('hex')}`;
    const qrBatchCode = '7741';

    // 16a. Cria encomenda individual + lote agrupado na Portaria (Condo Wave2)
    const createSingleQrPkg = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_WAVE2,
        recipientId: qrResidentId,
        packages: [
          {
            unit_number: '115',
            carrier: 'Mercado Livre',
            pickup_code: qrE2eCode,
            pickup_token: qrE2eToken,
          },
        ],
      },
      portariaWave2Headers
    );
    const qrSingleId = createSingleQrPkg.data?.packages?.[0]?.id;

    // 16b. Global Admin sem condominium_id fixo confirma WhatsApp via serviço real -> garante repasse de condominiumId
    let sentCondoParam: string | null | undefined = null;
    const adminConfirmSvcRes = await executeManualSendConfirmation({
      packageIds: [qrSingleId],
      condominiumId: CONDO_WAVE2,
      pickupCode: qrE2eCode,
      pickupToken: qrE2eToken,
      updatePackagesFn: async (ids, fields, passedCondoId) => {
        sentCondoParam = passedCondoId;
        const r = await requestJson(
          port,
          'POST',
          '/api/operational/packages/whatsapp-status',
          { packageIds: ids, fields, condominiumId: passedCondoId },
          adminHeaders
        );
        return {
          data: r.data?.data,
          error: r.status >= 200 && r.status < 300 ? null : { message: r.data?.error },
          status: r.status,
        };
      },
    });

    // 16c. Morador abre link /api/portal/package/:token e recebe QR payload { id, code, token }
    const residentPortalRes = await requestJson(port, 'GET', `/api/portal/package/${qrE2eToken}`);
    const portalPkg = residentPortalRes.data?.package;
    const scannedQrPayload = JSON.stringify({
      id: portalPkg?.id,
      code: portalPkg?.pickup_code,
      token: portalPkg?.pickup_token || qrE2eToken,
    });

    // 16d. Portaria lê o QR Code -> parse -> lookup ?status=all&lookup= -> validateQrScanResult
    const parsedSingleQr = parseQrScanInput(scannedQrPayload);
    const lookupSingleQr = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=all&lookup=${encodeURIComponent(parsedSingleQr.lookupTerm)}&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );
    const validatedSingleQr = validateQrScanResult({
      parsed: parsedSingleQr,
      matchedPackages: lookupSingleQr.data?.packages || [],
      expectedCondoId: CONDO_WAVE2,
      scanMethod: 'qr_code',
    });

    // 16e. Baixa automática executada diretamente no servidor (sem exigir confirmação manual)
    const auditBeforeE2e = db.tables.auditoria_eventos.length;
    const logsBeforeE2e = db.tables.retrieval_logs.length;
    const deliverSingleQr = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: validatedSingleQr.targetPackage?.id,
        packageIds: [validatedSingleQr.targetPackage?.id],
        condominiumId: CONDO_WAVE2,
        pickupToken: validatedSingleQr.targetPackage?.pickup_token,
        pickupCode: validatedSingleQr.targetPackage?.pickup_code,
        recipientId: validatedSingleQr.targetPackage?.recipient_id,
        deliveryMethod: 'qr_code',
        deliveredToName: 'Morador (Confirmado)',
        porterName: 'Porteiro QR',
      },
      portariaWave2Headers
    );

    // 16f. Encomendas com timestamps/status legados ou lote agrupado também são reconhecidas automaticamente
    const legacyTimestampPkgId = crypto.randomUUID();
    const legacyStatusNotifiedId = crypto.randomUUID();
    const batchPkg1Id = crypto.randomUUID();
    const batchPkg2Id = crypto.randomUUID();
    const batchResidentId = moradorIdsWave2[16];
    db.tables.packages.push(
      {
        id: legacyTimestampPkgId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[17],
        unit_number: '117',
        status: 'received',
        pickup_code: '9101',
        pickup_token: 'tok_legacy_ts_123456',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: '',
        notified_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
      },
      {
        id: legacyStatusNotifiedId,
        condominium_id: CONDO_WAVE2,
        recipient_id: moradorIdsWave2[18],
        unit_number: '118',
        status: 'notified',
        pickup_code: '9102',
        pickup_token: 'tok_legacy_status_1234',
        whatsapp_notified: false,
        whatsapp_sent: false,
        whatsapp_status: '',
        received_at: new Date().toISOString(),
      },
      {
        id: batchPkg1Id,
        condominium_id: CONDO_WAVE2,
        recipient_id: batchResidentId,
        unit_number: '116',
        status: 'received',
        pickup_code: qrBatchCode,
        pickup_token: qrBatchToken,
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
        received_at: new Date().toISOString(),
      },
      {
        id: batchPkg2Id,
        condominium_id: CONDO_WAVE2,
        recipient_id: batchResidentId,
        unit_number: '116',
        status: 'received',
        pickup_code: qrBatchCode,
        pickup_token: qrBatchToken,
        whatsapp_notified: true,
        whatsapp_sent: true,
        whatsapp_status: 'enviado',
        received_at: new Date().toISOString(),
      }
    );

    const parsedBatchQr = parseQrScanInput(JSON.stringify({ id: batchPkg1Id, code: qrBatchCode, token: qrBatchToken }));
    const lookupBatchQr = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=all&lookup=${encodeURIComponent(parsedBatchQr.lookupTerm)}&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );
    const validatedBatchQr = validateQrScanResult({
      parsed: parsedBatchQr,
      matchedPackages: lookupBatchQr.data?.packages || [],
      expectedCondoId: CONDO_WAVE2,
      scanMethod: 'qr_code',
    });
    const deliverBatchQr = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: validatedBatchQr.targetPackage?.id,
        packageIds: (validatedBatchQr.targetPackage?.packages || []).map((p: any) => p.id),
        condominiumId: CONDO_WAVE2,
        pickupToken: qrBatchToken,
        pickupCode: qrBatchCode,
        deliveryMethod: 'qr_code',
        porterName: 'Porteiro QR',
      },
      portariaWave2Headers
    );

    const deliverLegacyTs = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: legacyTimestampPkgId,
        condominiumId: CONDO_WAVE2,
        pickupToken: 'tok_legacy_ts_123456',
        pickupCode: '9101',
        deliveryMethod: 'qr_code',
      },
      portariaWave2Headers
    );

    const updatedSingleRow = db.tables.packages.find((p) => p.id === qrSingleId);
    const portariaDoesNotSetQrPkgBeforeNotifiedCheck = !portariaSource.includes(
      'const data = packagesFound[0];\n      setQrPackage(data);\n\n      // REGRA DE SEGURANÇA MANDATÓRIA'
    );

    assert(
      createSingleQrPkg.status === 200 &&
        adminConfirmSvcRes.ok &&
        sentCondoParam === CONDO_WAVE2 &&
        residentPortalRes.status === 200 &&
        Boolean(portalPkg?.id === qrSingleId) &&
        validatedSingleQr.ok === true &&
        validatedSingleQr.targetPackage?.id === qrSingleId &&
        deliverSingleQr.status === 200 &&
        updatedSingleRow?.status === 'delivered' &&
        updatedSingleRow?.pickup_qr_code === 'used' &&
        db.tables.retrieval_logs.length > logsBeforeE2e &&
        db.tables.auditoria_eventos.length > auditBeforeE2e &&
        isPackageNotificationConfirmed({ status: 'received', notified_at: new Date().toISOString() }) === true &&
        isPackageNotificationConfirmed({ status: 'notified' }) === true &&
        validatedBatchQr.ok === true &&
        validatedBatchQr.targetPackage?.isGroup === true &&
        validatedBatchQr.targetPackage?.packages?.length === 2 &&
        deliverBatchQr.status === 200 &&
        deliverBatchQr.data?.updatedIds?.length === 2 &&
        deliverLegacyTs.status === 200 &&
        portariaDoesNotSetQrPkgBeforeNotifiedCheck,
      '16. E2E QR Code: notificação confirmada (individual, lote, timestamp e Global Admin) reconhecida automaticamente e baixada via HTTP 200 sem re-prompt ou botão manual'
    );

    // 17. MATRIZ DE ERROS E BORDA NO QR CODE (10 cenários obrigatórios + isolamento por condomínio)
    // Cenário 1: QR inválido / corrompido / adulterado
    const invalidJsonQr = parseQrScanInput('{"corrupted":');
    const tamperedQr = validateQrScanResult({
      parsed: parseQrScanInput(JSON.stringify({ id: batchPkg1Id, code: '0000', token: 'wrong_tok_1234' })),
      matchedPackages: [db.tables.packages.find((p) => p.id === batchPkg1Id)],
      expectedCondoId: CONDO_WAVE2,
    });

    // Cenário 2: Encomenda já entregue
    const alreadyDeliveredLookup = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=all&lookup=${encodeURIComponent(qrE2eToken)}&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );
    const alreadyDeliveredVal = validateQrScanResult({
      parsed: parsedSingleQr,
      matchedPackages: alreadyDeliveredLookup.data?.packages || [],
      expectedCondoId: CONDO_WAVE2,
    });

    // Cenário 3: Encomenda realmente NÃO notificada (bloqueio rigoroso client + server, zero gravações)
    const unnotifiedId = crypto.randomUUID();
    const unnotifiedToken = `tok_unnotified_${crypto.randomBytes(6).toString('hex')}`;
    db.tables.packages.push({
      id: unnotifiedId,
      condominium_id: CONDO_WAVE2,
      recipient_id: moradorIdsWave2[19],
      unit_number: '119',
      status: 'received',
      pickup_code: '5511',
      pickup_token: unnotifiedToken,
      whatsapp_notified: false,
      whatsapp_sent: false,
      whatsapp_status: 'pending',
      received_at: new Date().toISOString(),
    });
    const logsBeforeUnnotified = db.tables.retrieval_logs.length;
    const auditBeforeUnnotified = db.tables.auditoria_eventos.length;
    const parsedUnnotified = parseQrScanInput(JSON.stringify({ id: unnotifiedId, code: '5511', token: unnotifiedToken }));
    const lookupUnnotified = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=all&lookup=${encodeURIComponent(unnotifiedToken)}&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );
    const unnotifiedClientBlock = validateQrScanResult({
      parsed: parsedUnnotified,
      matchedPackages: lookupUnnotified.data?.packages || [],
      expectedCondoId: CONDO_WAVE2,
    });
    const unnotifiedServerBlock = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: unnotifiedId,
        condominiumId: CONDO_WAVE2,
        pickupToken: unnotifiedToken,
        pickupCode: '5511',
        deliveryMethod: 'qr_code',
      },
      portariaWave2Headers
    );
    const unnotifiedRowAfter = db.tables.packages.find((p) => p.id === unnotifiedId);
    const logsAfterUnnotified = db.tables.retrieval_logs.length;
    const auditAfterUnnotified = db.tables.auditoria_eventos.length;

    // Cenário 4: Token/código inválido ou incompatível na rota deliver
    const mismatchTargetId = crypto.randomUUID();
    db.tables.packages.push({
      id: mismatchTargetId,
      condominium_id: CONDO_WAVE2,
      recipient_id: moradorIdsWave2[19],
      unit_number: '119',
      status: 'received',
      pickup_code: '6622',
      pickup_token: 'tok_real_6622_abcdef',
      whatsapp_notified: true,
      whatsapp_sent: true,
      whatsapp_status: 'enviado',
      received_at: new Date().toISOString(),
    });
    const mismatchTokenDeliver = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: mismatchTargetId,
        condominiumId: CONDO_WAVE2,
        pickupToken: 'tok_forged_9999999',
        pickupCode: '6622',
        deliveryMethod: 'qr_code',
      },
      portariaWave2Headers
    );

    // Cenário 5: QR Code de outro condomínio (isolamento estrito usando Portaria ativa de CONDO_B)
    const TOKEN_PORTARIA_B_ACTIVE = 'portaria-condo-b-active-token';
    db.tables.condominium_settings.push({
      condominium_id: CONDO_B,
      portaria_name: 'Portaria Beta',
      active_portaria_token: TOKEN_PORTARIA_B_ACTIVE,
      portaria_session_hours: 12,
      whatsapp_mode: 'manual',
    });
    const portariaBHeaders = { Authorization: `Bearer ${TOKEN_PORTARIA_B_ACTIVE}` };

    const crossCondoClientVal = validateQrScanResult({
      parsed: parseQrScanInput(JSON.stringify({ id: mismatchTargetId, code: '6622', token: 'tok_real_6622_abcdef' })),
      matchedPackages: [db.tables.packages.find((p) => p.id === mismatchTargetId)],
      expectedCondoId: CONDO_B,
    });
    const crossCondoLookupServer = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=all&lookup=tok_real_6622_abcdef&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaBHeaders // Portaria do CONDO_B tentando consultar pacote do CONDO_WAVE2
    );
    const crossCondoDeliverServer = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: mismatchTargetId,
        condominiumId: CONDO_B,
        pickupToken: 'tok_real_6622_abcdef',
        pickupCode: '6622',
        deliveryMethod: 'qr_code',
      },
      portariaBHeaders
    );

    // Cenário 6, 7 & 8: Concorrência + duplicidade consecutiva (1x 200, 1x 409, repetida 409)
    const [raceA, raceB] = await Promise.all([
      requestJson(
        port,
        'POST',
        '/api/operational/packages/deliver',
        {
          packageId: mismatchTargetId,
          condominiumId: CONDO_WAVE2,
          pickupToken: 'tok_real_6622_abcdef',
          pickupCode: '6622',
          deliveryMethod: 'qr_code',
        },
        portariaWave2Headers
      ),
      requestJson(
        port,
        'POST',
        '/api/operational/packages/deliver',
        {
          packageId: mismatchTargetId,
          condominiumId: CONDO_WAVE2,
          pickupToken: 'tok_real_6622_abcdef',
          pickupCode: '6622',
          deliveryMethod: 'qr_code',
        },
        portariaWave2Headers
      ),
    ]);
    const consecutiveDupDeliver = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: mismatchTargetId,
        condominiumId: CONDO_WAVE2,
        pickupToken: 'tok_real_6622_abcdef',
        pickupCode: '6622',
        deliveryMethod: 'qr_code',
      },
      portariaWave2Headers
    );

    // Cenário 9: Falha de escrita no banco durante baixa (HTTP 500, zero logs/auditoria falsos)
    const dbErrPkgId = crypto.randomUUID();
    db.tables.packages.push({
      id: dbErrPkgId,
      condominium_id: CONDO_WAVE2,
      recipient_id: moradorIdsWave2[19],
      unit_number: '119',
      status: 'received',
      pickup_code: '7733',
      pickup_token: 'tok_dberr_7733_abcdef',
      whatsapp_notified: true,
      whatsapp_sent: true,
      whatsapp_status: 'enviado',
      received_at: new Date().toISOString(),
    });
    const logsBeforeDbErr = db.tables.retrieval_logs.length;
    const auditBeforeDbErr = db.tables.auditoria_eventos.length;
    db.simulatePackagesUpdateError = true;
    const dbWriteErrDeliver = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: dbErrPkgId,
        condominiumId: CONDO_WAVE2,
        pickupToken: 'tok_dberr_7733_abcdef',
        pickupCode: '7733',
        deliveryMethod: 'qr_code',
      },
      portariaWave2Headers
    );
    db.simulatePackagesUpdateError = false;
    const dbErrRowAfter = db.tables.packages.find((p) => p.id === dbErrPkgId);

    // Garante que erro de rede/JSON malformado no lookup retorna vazio seguro sem 500
    const garbageLookupRes = await requestJson(
      port,
      'GET',
      `/api/operational/packages?status=all&lookup=${encodeURIComponent('$$invalid,or(1)')}&condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );

    const raceStatuses = [raceA.status, raceB.status].sort();
    const t17Checks = {
      invalidJson: !invalidJsonQr.isQrFormatValid,
      tampered: !tamperedQr.ok && tamperedQr.reason === 'invalid_qr',
      alreadyDelivered: !alreadyDeliveredVal.ok && alreadyDeliveredVal.reason === 'already_delivered',
      unnotifiedClient: !unnotifiedClientBlock.ok && unnotifiedClientBlock.reason === 'unnotified',
      unnotifiedServer: unnotifiedServerBlock.status === 403 && unnotifiedServerBlock.data?.requiresNotification === true,
      unnotifiedNoWrite:
        unnotifiedRowAfter?.status === 'received' &&
        logsAfterUnnotified === logsBeforeUnnotified &&
        auditAfterUnnotified === auditBeforeUnnotified,
      mismatchToken: mismatchTokenDeliver.status === 403,
      crossCondoClient: !crossCondoClientVal.ok && crossCondoClientVal.reason === 'cross_condo',
      crossCondoServer: crossCondoLookupServer.status === 403 && crossCondoDeliverServer.status === 403,
      race: raceStatuses[0] === 200 && raceStatuses[1] === 409,
      consecutiveDup: consecutiveDupDeliver.status === 409 && consecutiveDupDeliver.data?.alreadyDelivered === true,
      dbWriteErr:
        dbWriteErrDeliver.status === 500 &&
        dbErrRowAfter?.status === 'received' &&
        db.tables.retrieval_logs.length === logsBeforeDbErr &&
        db.tables.auditoria_eventos.length === auditBeforeDbErr,
      garbageLookup:
        garbageLookupRes.status === 200 &&
        Array.isArray(garbageLookupRes.data?.packages) &&
        garbageLookupRes.data.packages.length === 0,
    };
    const t17AllOk = Object.values(t17Checks).every(Boolean);
    if (!t17AllOk) {
      console.error('Test 17 failing checks:', Object.entries(t17Checks).filter(([, v]) => !v));
    }
    assert(
      t17AllOk,
      '17. Matriz completa de erros QR Code: inválido/adulterado, já entregue, não notificado, token incompatível, outro condomínio, concorrência/duplicidade, erro de banco e lookup malformado'
    );

    // 18. SINAIS SONOROS DO QR CODE (Portaria apenas, 1o som na leitura, 2o som SOMENTE após HTTP 200, cooldown independente & fallback seguro)
    const origWindow = (globalThis as any).window;
    const origNavigator = (globalThis as any).navigator;
    let audioFallbackSafe = false;
    let bothSoundsDistinctAndUnblocked = false;

    try {
      // 18a. Cenário 10: Áudio indisponível / bloqueado no navegador NÃO lança exceção
      (globalThis as any).window = undefined;
      const noWindowQr = feedback.qrRecognized();
      const noWindowDeliver = feedback.deliveryConfirmed();
      feedback.error();

      // Áudio presente porém resume() rejeitado / bloqueado por autoplay
      const createdOscFreqs: number[][] = [];
      class MockAudioContext {
        state = 'suspended';
        currentTime = 0;
        destination = {};
        resume() {
          return Promise.reject(new Error('Autoplay blocked by browser policy'));
        }
        createGain() {
          return {
            gain: {
              setValueAtTime: () => {},
              linearRampToValueAtTime: () => {},
              exponentialRampToValueAtTime: () => {},
            },
            connect: () => {},
          };
        }
        createOscillator() {
          const freqs: number[] = [];
          createdOscFreqs.push(freqs);
          return {
            type: 'sine',
            frequency: {
              setValueAtTime: (val: number) => freqs.push(val),
            },
            connect: () => {},
            start: () => {},
            stop: () => {},
          };
        }
      }

      (globalThis as any).window = { AudioContext: MockAudioContext };
      await new Promise((r) => setTimeout(r, 270)); // garante cooldown limpo para teste determinístico

      // Simula fluxo real rápido (<50ms entre captura QR e HTTP 200): ambos os sons DEVEM tocar sem se bloquearem!
      const cue1Played = feedback.qrRecognized();
      const cue2PlayedImmediatelyAfter = feedback.deliveryConfirmed();

      audioFallbackSafe = noWindowQr === false && noWindowDeliver === false;
      // Som 1 usa 1 oscilador (587.33 -> 880), Som 2 usa 3 osciladores (659.25, 880, 1108.73)
      const cue1Osc = createdOscFreqs[0] || [];
      const cue2Osc1 = createdOscFreqs[1] || [];
      const cue2Osc2 = createdOscFreqs[2] || [];
      const cue2Osc3 = createdOscFreqs[3] || [];

      bothSoundsDistinctAndUnblocked =
        cue1Played === true &&
        cue2PlayedImmediatelyAfter === true &&
        createdOscFreqs.length === 4 &&
        cue1Osc.includes(587.33) &&
        cue2Osc1.includes(659.25) &&
        cue2Osc2.includes(880) &&
        cue2Osc3.includes(1108.73);
    } finally {
      (globalThis as any).window = origWindow;
    }

    // Verifica estaticamente ordem dos triggers na Portaria e ausência total de áudio em Retirada.tsx
    const retiradaSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Retirada.tsx'), 'utf8');
    const qrRecognizedIdx = portariaSource.indexOf('feedback.qrRecognized()');
    const lookupGetIdx = portariaSource.indexOf('/api/operational/packages?status=all&lookup=');
    const deliverPostIdx = portariaSource.indexOf('/api/operational/packages/deliver');
    const deliverNotOkReturnIdx = portariaSource.indexOf('if (!deliverRes.ok)');
    const deliveryConfirmedIdx = portariaSource.indexOf('feedback.deliveryConfirmed()');

    assert(
      audioFallbackSafe &&
        bothSoundsDistinctAndUnblocked &&
        qrRecognizedIdx > 0 &&
        lookupGetIdx > qrRecognizedIdx &&
        deliverPostIdx > 0 &&
        deliverNotOkReturnIdx > deliverPostIdx &&
        deliveryConfirmedIdx > deliverNotOkReturnIdx &&
        !retiradaSource.includes('feedback') &&
        !retiradaSource.includes('AudioContext'),
      '18. Alertas sonoros QR Code: Som 1 na leitura, Som 2 distinto SOMENTE após HTTP 200 (sem cooldown cruzado), fallback seguro e zero áudio em Retirada.tsx'
    );

    // 19. SUÍTE CIRÚRGICA AVISAR MORADOR (10 cenários obrigatórios: schema sem notified_at, modos, entregues, grupos mistos, api_automatica, foco e pré-salvamento)
    // 19a. Persistência funciona mesmo sem coluna notified_at no schema + passa a exibir "Avisado"
    const noColSingleId = crypto.randomUUID();
    const noColToken = `tok_nocol_${crypto.randomBytes(6).toString('hex')}`;
    const noColResidentId = moradorIdsWave2[18];
    db.simulateMissingNotifiedAtColumn = true;
    const createNoColRes = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_WAVE2,
        recipientId: noColResidentId,
        packages: [
          {
            id: noColSingleId,
            condominium_id: CONDO_WAVE2,
            recipient_id: noColResidentId,
            unit_number: '118',
            status: 'received',
            pickup_code: '8282',
            pickup_token: noColToken,
            whatsapp_notified: false,
            whatsapp_sent: false,
            whatsapp_status: 'pending',
            notified_at: null,
            received_at: new Date().toISOString(),
          },
        ],
      },
      portariaWave2Headers
    );

    const confirmNoColRes = await requestJson(
      port,
      'POST',
      '/api/operational/packages/whatsapp-status',
      {
        packageIds: [noColSingleId],
        condominiumId: CONDO_WAVE2,
        fields: {
          whatsapp_notified: true,
          whatsapp_sent: true,
          whatsapp_status: 'enviado',
          notified_at: new Date().toISOString(),
          whatsapp_sent_at: new Date().toISOString(),
          last_notification_at: new Date().toISOString(),
        },
      },
      portariaWave2Headers
    );
    const activityNoColRes = await requestJson(
      port,
      'GET',
      `/api/portaria/activity?condominiumId=${CONDO_WAVE2}`,
      undefined,
      portariaWave2Headers
    );
    const createdNoColPkg = createNoColRes.data?.packages?.[0];
    const deliverNoColQrRes = await requestJson(
      port,
      'POST',
      '/api/operational/packages/deliver',
      {
        packageId: createdNoColPkg?.id || noColSingleId,
        condominiumId: CONDO_WAVE2,
        pickupToken: createdNoColPkg?.pickup_token || noColToken,
        pickupCode: createdNoColPkg?.pickup_code || '8282',
        deliveryMethod: 'qr_code',
      },
      portariaWave2Headers
    );
    db.simulateMissingNotifiedAtColumn = false;

    const noColRowAfterConfirm = confirmNoColRes.data?.data?.[0];
    const noColBadgeAfterConfirm = getPackageNotificationBadgeState(noColRowAfterConfirm, { notifyAfter: true });

    // 19b. Encomenda entregue NUNCA exibe AVISAR MORADOR (mesmo se não notificada)
    const deliveredUnnotifiedPkg = {
      id: 'pkg-del-unnotified',
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      whatsapp_notified: false,
      whatsapp_sent: false,
      whatsapp_status: 'pending',
    };
    const deliveredGroupPkg = {
      id: 'pkg-del-group',
      isGroup: true,
      packages: [deliveredUnnotifiedPkg, { ...deliveredUnnotifiedPkg, id: 'pkg-del-unnotified-2' }],
    };
    const deliveredBadgeAfter = getPackageNotificationBadgeState(deliveredUnnotifiedPkg, { notifyAfter: true });
    const deliveredBadgeAuto = getPackageNotificationBadgeState(deliveredUnnotifiedPkg, { notifyAfter: false });
    const deliveredGroupBadge = getPackageNotificationBadgeState(deliveredGroupPkg, { notifyAfter: true });

    // 19c. Modo ENVIO AUTOMÁTICO (notifyAfter === false) oculta acionamento operacional no cabeçalho e card;
    //      Modo APÓS REGISTRO (notifyAfter === true) preserva ciclo de 3 min (180.000 ms)
    const pendingUnnotifiedPkg = {
      id: 'pkg-pend-1',
      recipient_id: noColResidentId,
      status: 'received',
      whatsapp_notified: false,
      whatsapp_sent: false,
      whatsapp_status: 'pending',
    };
    const autoModeHeader = shouldShowOperationalNotifyHeader({
      notifyAfter: false,
      showInactivityAlert: true,
      pendingNoticesCount: 5,
    });
    const autoModeCardBadge = getPackageNotificationBadgeState(pendingUnnotifiedPkg, { notifyAfter: false });
    const notifyAfterBefore3Min = shouldShowInactivityAlert({
      lastActivityTimestamp: 1000000,
      now: 1000000 + INACTIVITY_ALERT_TIMEOUT_MS - 1,
      pendingCount: 2,
      notifyAfter: true,
    });
    const notifyAfterAt3Min = shouldShowInactivityAlert({
      lastActivityTimestamp: 1000000,
      now: 1000000 + INACTIVITY_ALERT_TIMEOUT_MS,
      pendingCount: 2,
      notifyAfter: true,
    });
    const afterModeHeaderBefore3m = shouldShowOperationalNotifyHeader({
      notifyAfter: true,
      showInactivityAlert: notifyAfterBefore3Min,
      pendingNoticesCount: 2,
    });
    const afterModeHeaderAt3m = shouldShowOperationalNotifyHeader({
      notifyAfter: true,
      showInactivityAlert: notifyAfterAt3Min,
      pendingNoticesCount: 2,
    });
    const afterModeCardBadgeBefore3m = getPackageNotificationBadgeState(pendingUnnotifiedPkg, {
      notifyAfter: true,
      showInactivityAlert: notifyAfterBefore3Min,
    });
    const afterModeCardBadge = getPackageNotificationBadgeState(pendingUnnotifiedPkg, {
      notifyAfter: true,
      showInactivityAlert: notifyAfterAt3Min,
    });

    // 19d. Grupos mistos (1 confirmado + 1 pendente) sem falsos positivos
    const confirmedItem = {
      id: 'pkg-grp-1',
      recipient_id: noColResidentId,
      status: 'received',
      whatsapp_notified: true,
      whatsapp_sent: true,
      whatsapp_status: 'enviado',
    };
    const pendingItem = {
      id: 'pkg-grp-2',
      recipient_id: noColResidentId,
      status: 'received',
      whatsapp_notified: false,
      whatsapp_sent: false,
      whatsapp_status: 'pending',
    };
    const mixedGroup = {
      id: 'pkg-grp-1',
      isGroup: true,
      packages: [confirmedItem, pendingItem],
    };
    const mixedSummary = getGroupNotificationSummary(mixedGroup);
    const mixedBadgeBefore3m = getPackageNotificationBadgeState(mixedGroup, {
      notifyAfter: true,
      showInactivityAlert: false,
    });
    const mixedBadge = getPackageNotificationBadgeState(mixedGroup, {
      notifyAfter: true,
      showInactivityAlert: true,
    });
    const needingFromMixed = getPackagesNeedingNotification([confirmedItem, pendingItem], []);

    // 19e. api_automatica NÃO abre fluxo manual simultâneo
    const opensManualWithApi = shouldOpenManualWhatsAppOnCreate({
      hasValidPhone: true,
      notifyAfter: false,
      apiActive: true,
    });
    const opensManualWithoutApi = shouldOpenManualWhatsAppOnCreate({
      hasValidPhone: true,
      notifyAfter: false,
      apiActive: false,
    });
    const opensManualInNotifyAfter = shouldOpenManualWhatsAppOnCreate({
      hasValidPhone: true,
      notifyAfter: true,
      apiActive: false,
    });

    // 19f. Verificações estáticas cirúrgicas em Portaria.tsx, PackageNew.tsx, PackageItem.tsx e PackageList.tsx
    const pkgNewSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PackageNew.tsx'), 'utf8');
    const pkgItemSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/portaria/PackageItem.tsx'), 'utf8');
    const pkgListSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PackageList.tsx'), 'utf8');

    const t19Checks = {
      noColCreateOk: createNoColRes.status === 200,
      noColConfirmOk:
        confirmNoColRes.status === 200 &&
        noColRowAfterConfirm?.whatsapp_notified === true &&
        noColRowAfterConfirm?.whatsapp_sent === true &&
        noColBadgeAfterConfirm.kind === 'confirmed' &&
        noColBadgeAfterConfirm.label === '💬 Avisado',
      noColActivityOk: activityNoColRes.status === 200 && typeof activityNoColRes.data?.lastActivityTimestamp === 'number',
      noColDeliverOk: deliverNoColQrRes.status === 200,
      deliveredNeverShowsAvisar:
        isPackageDelivered(deliveredUnnotifiedPkg) === true &&
        deliveredBadgeAfter.kind === 'delivered_unnotified' &&
        deliveredBadgeAfter.label === null &&
        deliveredBadgeAfter.isPulsing === false &&
        deliveredBadgeAuto.label === null &&
        deliveredGroupBadge.label === null,
      autoModeHidesOperationalTrigger:
        autoModeHeader === false &&
        autoModeCardBadge.kind === 'auto_pending' &&
        autoModeCardBadge.isClickable === false &&
        autoModeCardBadge.isPulsing === false &&
        autoModeCardBadge.label !== '💬 Avisar Morador',
      afterModePreserves3MinCycle:
        INACTIVITY_ALERT_TIMEOUT_MS === 180000 &&
        notifyAfterBefore3Min === false &&
        notifyAfterAt3Min === true &&
        afterModeHeaderBefore3m === false &&
        afterModeHeaderAt3m === true &&
        afterModeCardBadgeBefore3m.kind === 'notify_after_waiting' &&
        afterModeCardBadgeBefore3m.label === null &&
        afterModeCardBadgeBefore3m.isClickable === false &&
        afterModeCardBadge.kind === 'notify_after_pending' &&
        afterModeCardBadge.isClickable === true &&
        afterModeCardBadge.isPulsing === true,
      mixedGroupAccurate:
        isPackageNotificationConfirmed(mixedGroup) === false &&
        mixedSummary.totalItems === 2 &&
        mixedSummary.confirmedItems === 1 &&
        mixedSummary.pendingItems === 1 &&
        mixedSummary.isMixed === true &&
        mixedBadgeBefore3m.kind === 'notify_after_waiting' &&
        mixedBadgeBefore3m.label === null &&
        mixedBadge.kind === 'notify_after_pending' &&
        mixedBadge.label === '💬 Avisar Morador (1/2)' &&
        needingFromMixed.length === 1 &&
        needingFromMixed[0].id === 'pkg-grp-2',
      noDoubleDispatchApi:
        opensManualWithApi === false &&
        opensManualWithoutApi === true &&
        opensManualInNotifyAfter === false &&
        pkgNewSource.includes('shouldOpenManualWhatsAppOnCreate') &&
        !pkgNewSource.includes('.catch(syncErr => console.warn'),
      focusAndPreSaveAndIndicatorsSafe:
        portariaSource.includes('if (pendingModal) {\n          return;\n        }') &&
        portariaSource.includes('}, [packages, residents]);') &&
        portariaSource.includes('isBatchManual: true') &&
        portariaSource.includes('allowFromDeliveryGuard: true') &&
        portariaSource.includes('shouldShowOperationalNotifyHeader') &&
        pkgNewSource.includes('isReturnModalVisible') &&
        pkgNewSource.includes('beginWhatsAppReturnTracking') &&
        pkgNewSource.includes('recoverCameraIfNeeded') &&
        pkgNewSource.includes('CONTATO DIRETO NO WHATSAPP') &&
        pkgItemSource.includes('isPackageNotificationConfirmed(pkg)') &&
        pkgListSource.includes('getPackageNotificationBadgeState'),
    };
    const t19AllOk = Object.values(t19Checks).every(Boolean);
    if (!t19AllOk) {
      console.error('Test 19 failing checks:', Object.entries(t19Checks).filter(([, v]) => !v));
    }
    assert(
      t19AllOk,
      '19. Correção cirúrgica AVISAR MORADOR: fallback sem notified_at, modo exclusivo APÓS REGISTRO (3 min preservados), zero aviso em entregues, grupos mistos, api_automatica sem duplicidade, proteção de foco e consistência UI'
    );

    // ---------------------------------------------------------------------------------
    // TESTE 20: Homologação REENVIAR + Organização Visual do Card + Preservação 3 Min
    // ---------------------------------------------------------------------------------
    const resendHttpPkgId = crypto.randomUUID();
    const origNotifiedTs = '2026-11-18T09:00:00.000Z';
    db.tables.packages.push({
      id: resendHttpPkgId,
      condominium_id: CONDO_WAVE2,
      recipient_id: noColResidentId,
      unit_label: 'BLOCO B - AP 202',
      carrier: 'Mercado Livre',
      status: 'received',
      whatsapp_notified: true,
      whatsapp_sent: true,
      whatsapp_status: 'enviado',
      notified_at: origNotifiedTs,
      whatsapp_sent_at: origNotifiedTs,
      last_notification_at: origNotifiedTs,
      pickup_code: '7744',
      pickup_token: 'tok-http-resend-1',
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const newResendTs = '2026-11-19T14:30:00.000Z';
    const httpResendConfirmRes = await requestJson(
      port,
      'POST',
      '/api/operational/packages/whatsapp-status',
      {
        packageIds: [resendHttpPkgId],
        condominiumId: CONDO_WAVE2,
        fields: {
          whatsapp_notified: true,
          whatsapp_sent: true,
          whatsapp_status: 'enviado',
          notified_at: origNotifiedTs,
          whatsapp_sent_at: origNotifiedTs,
          last_notification_at: newResendTs,
          pickup_code: '7744',
          pickup_token: 'tok-http-resend-1',
        },
      },
      portariaWave2Headers
    );
    const dbPkgAfterResend = db.tables.packages.find((p) => p.id === resendHttpPkgId);

    const latestPortariaSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Portaria.tsx'), 'utf8');
    const latestPkgItemSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/portaria/PackageItem.tsx'), 'utf8');

    // Extrai classes dos pills AVISADO e REENVIAR para verificar forma/tamanho equivalentes
    const avisadoPillBlock = latestPortariaSource.match(/if \(badgeState\.kind === 'confirmed'\)[\s\S]*?<span className="text-\[12px\] font-black uppercase tracking-wide">\{badgeState\.label\}<\/span>/)?.[0] || '';
    const resendButtonBlock = latestPkgItemSource.match(/\{showResend && \([\s\S]*?<\/button>/)?.[0] || '';
    const row1Block = latestPkgItemSource.match(/<div className="flex justify-between items-start gap-2 mb-4">[\s\S]*?<div className="flex items-center justify-between mb-4">/)?.[0] || '';
    const row2Block = latestPkgItemSource.match(/<div className="flex items-center justify-between mb-4">[\s\S]*?<\/div>/)?.[0] || '';

    const t20Checks = {
      httpResendPreservesOperationalStatus:
        httpResendConfirmRes.status === 200 &&
        dbPkgAfterResend?.status === 'received' &&
        dbPkgAfterResend?.whatsapp_notified === true &&
        dbPkgAfterResend?.whatsapp_sent === true &&
        dbPkgAfterResend?.whatsapp_status === 'enviado' &&
        dbPkgAfterResend?.notified_at === origNotifiedTs &&
        dbPkgAfterResend?.last_notification_at === newResendTs &&
        dbPkgAfterResend?.pickup_code === '7744' &&
        dbPkgAfterResend?.pickup_token === 'tok-http-resend-1',
      threeMinCyclePreservedUntouched:
        INACTIVITY_ALERT_TIMEOUT_MS === 180000 &&
        shouldShowInactivityAlert({ lastActivityTimestamp: 1000, now: 1000 + 179999, pendingCount: 1, notifyAfter: true }) === false &&
        shouldShowInactivityAlert({ lastActivityTimestamp: 1000, now: 1000 + 180000, pendingCount: 1, notifyAfter: true }) === true &&
        shouldShowOperationalNotifyHeader({ notifyAfter: true, showInactivityAlert: false, pendingNoticesCount: 1 }) === false &&
        shouldShowOperationalNotifyHeader({ notifyAfter: true, showInactivityAlert: true, pendingNoticesCount: 1 }) === true,
      pendentesMovedNextToPackageIconOnSameRow:
        row1Block.includes('<div className="flex items-center gap-4 min-w-0">') &&
        row1Block.includes('Pendentes') &&
        row1Block.indexOf('</svg>') < row1Block.indexOf('Pendentes') &&
        row1Block.indexOf('Pendentes') < row1Block.indexOf('showResend'),
      resendInTopRightRedMatchingAvisadoSizeAndShape:
        avisadoPillBlock.includes('px-5 py-0.5') &&
        avisadoPillBlock.includes('rounded-full border') &&
        avisadoPillBlock.includes('text-[12px] font-black uppercase tracking-wide') &&
        resendButtonBlock.includes('px-5 py-0.5') &&
        resendButtonBlock.includes('rounded-full border') &&
        resendButtonBlock.includes('bg-red-600') &&
        resendButtonBlock.includes('text-white') &&
        resendButtonBlock.includes('text-[12px] font-black uppercase tracking-wide') &&
        resendButtonBlock.includes('Reenviar'),
      avisadoAvisarRowPreservedUntouched:
        row2Block.includes('{getWhatsAppBadge(pkg.whatsapp_status, pkg)}') &&
        row2Block.includes('{pkg.moradores?.nome'),
      portariaWiredWithResendAndSafetyGuards:
        latestPortariaSource.includes('handleResendNotify') &&
        latestPortariaSource.includes('onResend={handleResendNotify}') &&
        latestPortariaSource.includes('isResend: true') &&
        latestPortariaSource.includes('getConfirmedPackagesForResend') &&
        latestPkgItemSource.includes('canShowResendButton(pkg)') &&
        canShowResendButton(dbPkgAfterResend) === true &&
        getConfirmedPackagesForResend({ isGroup: true, packages: [dbPkgAfterResend, pendingUnnotifiedPkg] }).length === 1,
    };

    const t20AllOk = Object.values(t20Checks).every(Boolean);
    if (!t20AllOk) {
      console.error('Test 20 failing checks:', Object.entries(t20Checks).filter(([, v]) => !v));
    }
    assert(
      t20AllOk,
      '20. Homologação REENVIAR + layout PackageItem (PENDENTES ao lado do ícone, REENVIAR vermelho idêntico ao AVISADO no topo direito, linha AVISADO preservada, 3 min intacto)'
    );

    // ---------------------------------------------------------------------------------
    // TESTE 21: Correção Definitiva AVISAR MORADOR nos Cards vinculada a showInactivityAlert
    // ---------------------------------------------------------------------------------
    const pendingGroupedCard = {
      id: 'pkg-pend-grp-1',
      isGroup: true,
      packages: [pendingUnnotifiedPkg, { ...pendingItem, id: 'pkg-pend-grp-2' }],
    };
    const fullConfirmedGroupCard = {
      id: 'pkg-conf-grp-1',
      isGroup: true,
      packages: [confirmedItem, { ...confirmedItem, id: 'pkg-conf-grp-2' }],
    };

    const t0 = 1_700_000_000_000;
    const alertBefore3m = shouldShowInactivityAlert({
      lastActivityTimestamp: t0,
      now: t0 + INACTIVITY_ALERT_TIMEOUT_MS - 1,
      pendingCount: 2,
      notifyAfter: true,
    });
    const alertAt3m = shouldShowInactivityAlert({
      lastActivityTimestamp: t0,
      now: t0 + INACTIVITY_ALERT_TIMEOUT_MS,
      pendingCount: 2,
      notifyAfter: true,
    });
    const alertWhenNoPending = shouldShowInactivityAlert({
      lastActivityTimestamp: t0,
      now: t0 + INACTIVITY_ALERT_TIMEOUT_MS + 60000,
      pendingCount: 0,
      notifyAfter: true,
    });

    const singleBefore3m = getPackageNotificationBadgeState(pendingUnnotifiedPkg, {
      notifyAfter: true,
      showInactivityAlert: alertBefore3m,
      interactive: true,
    });
    const groupBefore3m = getPackageNotificationBadgeState(pendingGroupedCard, {
      notifyAfter: true,
      showInactivityAlert: alertBefore3m,
      interactive: true,
    });
    const singleAfter3m = getPackageNotificationBadgeState(pendingUnnotifiedPkg, {
      notifyAfter: true,
      showInactivityAlert: alertAt3m,
      interactive: true,
    });
    const groupAfter3m = getPackageNotificationBadgeState(pendingGroupedCard, {
      notifyAfter: true,
      showInactivityAlert: alertAt3m,
      interactive: true,
    });
    const confirmedBefore3m = getPackageNotificationBadgeState(confirmedItem, {
      notifyAfter: true,
      showInactivityAlert: alertBefore3m,
      interactive: true,
    });
    const confirmedGroupAfter3m = getPackageNotificationBadgeState(fullConfirmedGroupCard, {
      notifyAfter: true,
      showInactivityAlert: alertAt3m,
      interactive: true,
    });
    const headerWhenCleared = shouldShowOperationalNotifyHeader({
      notifyAfter: true,
      showInactivityAlert: alertWhenNoPending,
      pendingNoticesCount: 0,
    });
    const portariaGetBadgeBlock = latestPortariaSource.match(/const getWhatsAppBadge = [\s\S]*?const badgeState = getPackageNotificationBadgeState\([\s\S]*?\}\);/)?.[0] || '';

    const t21Checks = {
      pendingSingleAndGroupHiddenBefore3Min:
        alertBefore3m === false &&
        singleBefore3m.kind === 'notify_after_waiting' &&
        singleBefore3m.label === null &&
        singleBefore3m.isClickable === false &&
        singleBefore3m.isPulsing === false &&
        groupBefore3m.kind === 'notify_after_waiting' &&
        groupBefore3m.label === null &&
        groupBefore3m.isClickable === false &&
        groupBefore3m.isPulsing === false,
      pendingSingleAndGroupShownAfterShowInactivityAlert:
        alertAt3m === true &&
        singleAfter3m.kind === 'notify_after_pending' &&
        singleAfter3m.label === '💬 Avisar Morador' &&
        singleAfter3m.isClickable === true &&
        singleAfter3m.isPulsing === true &&
        groupAfter3m.kind === 'notify_after_pending' &&
        groupAfter3m.label === '💬 Avisar Morador' &&
        groupAfter3m.summary.pendingItems === 2,
      confirmedCardShowsAvisadoAndNeverAvisar:
        confirmedBefore3m.kind === 'confirmed' &&
        confirmedBefore3m.label === '💬 Avisado' &&
        confirmedGroupAfter3m.kind === 'confirmed' &&
        confirmedGroupAfter3m.label === '💬 Avisado' &&
        canShowResendButton(confirmedItem) === true &&
        canShowResendButton(fullConfirmedGroupCard) === true,
      mixedGroupSignalsOnlyPendingAfter3Min:
        mixedBadgeBefore3m.label === null &&
        mixedBadge.kind === 'notify_after_pending' &&
        mixedBadge.label === '💬 Avisar Morador (1/2)' &&
        canShowResendButton(mixedGroup) === false,
      zeroPendingEndsAlertsAndHeader:
        alertWhenNoPending === false && headerWhenCleared === false,
      portariaPassesExistingShowInactivityAlertToBadgeState:
        portariaGetBadgeBlock.includes('notifyAfter') &&
        portariaGetBadgeBlock.includes('showInactivityAlert'),
    };

    const t21AllOk = Object.values(t21Checks).every(Boolean);
    if (!t21AllOk) {
      console.error('Test 21 failing checks:', Object.entries(t21Checks).filter(([, v]) => !v));
    }
    assert(
      t21AllOk,
      '21. Cards AVISAR MORADOR no modo APÓS REGISTRO respeitam showInactivityAlert (ocultos < 3 min, ativos >= 3 min em individuais/agrupados/mistos, encerrados ao zerar pendências)'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\nResumo Final Regressões: ${passed}/${total} verificações aprovadas.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error('Erro fatal na suíte de regressões:', err);
  process.exit(1);
});
