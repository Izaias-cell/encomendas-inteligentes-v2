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
  uploadCount = 0;
  packageWriteCount = 0;

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

          const totalCount = rows.length;
          if (rangeStart !== null && rangeEnd !== null) {
            rows = rows.slice(rangeStart, rangeEnd + 1);
          } else if (limitVal !== null) {
            rows = rows.slice(0, limitVal);
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
  const RESIDENT_USER_ID = 'dddd0000-0000-4000-8000-000000000004';
  const RES_INACTIVE_WITH_PKG_ID = 'eeee0000-0000-4000-8000-000000000005';
  const RES_INACTIVE_NO_PKG_ID = 'ffff0000-0000-4000-8000-000000000006';
  const RESIDENT_A2_ID = '11110000-0000-4000-8000-000000000007';
  const RESIDENT_B_ID = '22220000-0000-4000-8000-000000000008';

  const TOKEN_ADMIN = 'reg-jwt-admin';
  const TOKEN_SINDICO = 'reg-jwt-sindico';
  const TOKEN_UNLINKED_ADMIN = 'reg-jwt-unlinked-admin';
  const TOKEN_RESIDENT_USER = 'reg-jwt-resident-user';
  const TOKEN_PORTARIA_A = 'reg_portaria_session_alpha_token_12345';

  const db = new RegressionMockSupabase();
  db.authTokens.set(TOKEN_ADMIN, { id: ADMIN_ID, email: 'admin@reg.com' });
  db.authTokens.set(TOKEN_SINDICO, { id: SINDICO_ID, email: 'sindico@reg.com' });
  db.authTokens.set(TOKEN_UNLINKED_ADMIN, { id: UNLINKED_ADMIN_ID, email: 'unlinked@reg.com' });
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
      portariaHeaders
    );

    // 6d. Mixed distinct valid recipients in same condo -> 400, zero partial saves, zero uploads
    const mixedSameCondoRecipientsBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
          { recipient_id: RESIDENT_A2_ID, unit_number: '402', carrier: 'Amazon', photo_url: tinyPngBase64 },
        ],
      },
      portariaHeaders
    );

    // 6e. Nonexistent recipient in batch -> 404, zero partial saves, zero uploads
    const nonexistentRecipientBatch = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        recipientId: RESIDENT_USER_ID,
        packages: [
          { recipient_id: RESIDENT_USER_ID, unit_number: '305', carrier: 'Shopee', photo_url: tinyPngBase64 },
          { recipient_id: '99999999-9999-4999-8999-999999999999', unit_number: '999', carrier: 'Correios' },
        ],
      },
      portariaHeaders
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

    // 6g. Valid multi-item batch for Condo A resident (with omitted condominiumId derived from session + base64 photo) -> 200
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
      portariaHeaders
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
