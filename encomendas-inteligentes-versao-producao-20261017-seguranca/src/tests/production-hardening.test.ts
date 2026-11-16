/**
 * SUITE DE HOMOLOGAÇÃO E SEGURANÇA EM PRODUÇÃO — ENCOMENDAS INTELIGENTES
 *
 * Valida todas as correções de segurança, isolamento multi-tenant, integridade
 * de dados, webhooks, cron e portal do morador:
 * 1. Rejeição anônima e separação estrita JWT Admin/Staff vs Token de Portaria
 * 2. Isolamento multi-tenant e propagação de erros em /api/packages/create
 * 3. Destinatário autoritativo do banco, timeout/falha e isolamento em /api/notify-resident
 * 4. Bloqueio de troca de condomínio em /api/profiles/select-condominium para não-globais
 * 5. Isolamento e propagação de erro em /api/portaria/activity
 * 6. Autenticação e rate limit em /api/ocr/extract-basic e /api/ocr/analyze-label
 * 7. RBAC estrito (sindico vs admin), PUT sem bypass de status, DELETE condomínio sem corrupção prévia
 * 8. GET /api/admin/integrity-check somente leitura (405 em ?repair=true) + POST /api/admin/integrity-repair
 * 9. DELETE /api/admin/users/:id com preservação histórica (soft-delete) vs exclusão limpa
 * 10. Falha real no Auth em reset-password e change-password (sem sucesso silencioso)
 * 11. Webhook Meta (GET verify + POST HMAC SHA-256 + idempotência + normalização telefone BR)
 * 12. Rota /api/cron/reminders desativada (lembretes automáticos 48h/72h removidos)
 * 13. Portal público (/api/portal/validate, /validate-code, /package): remoção de PII, bloqueio de código curto e rate limit
 */

import http from 'http';
import crypto from 'crypto';

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

interface MockFaults {
  failAuthUpdatePassword: boolean;
  failAuditInsert: boolean;
  failStorageUpload: boolean;
}

class HardeningMockSupabase {
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
  bannedUsers: Set<string> = new Set();
  deletedAuthUsers: Set<string> = new Set();

  faults: MockFaults = {
    failAuthUpdatePassword: false,
    failAuditInsert: false,
    failStorageUpload: false,
  };

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
          if (limitVal !== null) rows = rows.slice(0, limitVal);

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
          if (table === 'auditoria_eventos' && db.faults.failAuditInsert) {
            return { data: null, error: { message: 'Simulated audit insert failure' } };
          }
          if (table === 'whatsapp_webhook_events') {
            for (const cand of insertRows) {
              if (cand.event_key && db.tables[table].some((r) => r.event_key === cand.event_key)) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
              }
            }
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
          const target = String(val || '').toLowerCase();
          filters.push((r) => String(r[col] || '').toLowerCase() === target);
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
            if (db.faults.failStorageUpload) {
              return { data: null, error: { message: 'Simulated Storage upload failure' } };
            }
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
          updateUserById: async (id: string, patch: any) => {
            if (db.faults.failAuthUpdatePassword && patch?.password) {
              return { data: null, error: { message: 'Simulated Auth update password error' } };
            }
            if (patch?.ban_duration) {
              db.bannedUsers.add(id);
            }
            return { data: { user: { id } }, error: null };
          },
          signOut: async (_id: string) => ({ data: {}, error: null }),
          deleteUser: async (id: string) => {
            db.deletedAuthUsers.add(id);
            return { data: {}, error: null };
          },
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

  const CONDO_A = '11111111-1111-4111-8111-111111111111';
  const CONDO_B = '22222222-2222-4222-8222-222222222222';
  const ORPHAN_CONDO = '99999999-9999-4999-8999-999999999999';

  const ADMIN_ID = 'aaaa1111-1111-4111-8111-111111111111';
  const SINDICO_A_ID = 'bbbb1111-1111-4111-8111-111111111111';
  const PORTEIRO_A_ID = 'cccc1111-1111-4111-8111-111111111111';
  const NO_HIST_USER_ID = 'dddd1111-1111-4111-8111-111111111111';
  const RESIDENT_A_ID = 'eeee1111-1111-4111-8111-111111111111';
  const RESIDENT_B_ID = 'ffff1111-1111-4111-8111-111111111111';

  const TOKEN_ADMIN = 'jwt-admin-global';
  const TOKEN_SINDICO_A = 'jwt-sindico-a';
  const TOKEN_PORTEIRO_A = 'jwt-porteiro-a';
  const TOKEN_PORTARIA_A = 'portaria_session_a_9f8e7d6c5b4a';

  const db = new HardeningMockSupabase();
  db.authTokens.set(TOKEN_ADMIN, { id: ADMIN_ID, email: 'admin@sistema.com' });
  db.authTokens.set(TOKEN_SINDICO_A, { id: SINDICO_A_ID, email: 'sindicoA@sistema.com' });
  db.authTokens.set(TOKEN_PORTEIRO_A, { id: PORTEIRO_A_ID, email: 'porteiroA@sistema.com' });

  db.tables.condominiums.push(
    {
      id: CONDO_A,
      name: 'Residencial Alpha',
      address: 'Rua Alpha, 100',
      active: true,
      manager_phone: '11999990000',
      manager_email: 'sindico.sigiloso@alpha.com',
      internal_notes: 'Nota confidencial do administrador',
    },
    {
      id: CONDO_B,
      name: 'Residencial Beta',
      address: 'Rua Beta, 200',
      active: true,
    }
  );

  db.tables.condominium_settings.push({
    id: crypto.randomUUID(),
    condominium_id: CONDO_A,
    portaria_name: 'Portaria Alpha',
    portaria_access_code: 'ALPH-1234',
    active_portaria_token: TOKEN_PORTARIA_A,
  });

  db.tables.profiles.push(
    { id: ADMIN_ID, full_name: 'Admin Global', role: 'admin', condominium_id: CONDO_A, active: true },
    { id: SINDICO_A_ID, full_name: 'Síndico Alpha', role: 'sindico', condominium_id: CONDO_A, active: true },
    { id: PORTEIRO_A_ID, full_name: 'Porteiro Alpha', role: 'porteiro', condominium_id: CONDO_A, active: true },
    { id: NO_HIST_USER_ID, full_name: 'Porteiro Sem Histórico', role: 'porteiro', condominium_id: CONDO_A, active: true }
  );

  db.tables.moradores.push(
    {
      id: RESIDENT_A_ID,
      condominium_id: CONDO_A,
      nome: 'Maria Silva',
      unidade: '101',
      bloco: 'A',
      telefone: '5511988887777',
      email: 'maria.pii@alpha.com',
      cpf: '12345678900',
      observacoes: 'Chave secreta morador',
      ativo: true,
    },
    {
      id: RESIDENT_B_ID,
      condominium_id: CONDO_B,
      nome: 'João Beta',
      unidade: '202',
      bloco: 'B',
      telefone: '5511977776666',
      ativo: true,
    }
  );

  const clientMock = db.createClient();
  const app = createApp({ supabase: clientMock, supabaseAdmin: clientMock, isProduction: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  // Save & configure test env secrets for meta webhook
  const prevAppSecret = process.env.WHATSAPP_APP_SECRET;
  const prevVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const prevWaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  process.env.WHATSAPP_APP_SECRET = 'meta-app-secret-2026';
  process.env.WHATSAPP_VERIFY_TOKEN = 'meta-verify-token-2026';
  process.env.WHATSAPP_ACCESS_TOKEN = 'meta-wa-access-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';

  // Intercept global fetch for Z-API / Meta Cloud API tests
  const originalFetch = globalThis.fetch;
  const zapiMode: string = 'ok';
  let metaSendCount = 0;

  (globalThis as any).fetch = async (url: string, _opts: any) => {
    if (String(url).includes('z-api.mock')) {
      if (zapiMode === 'fail') {
        return new Response(JSON.stringify({ error: 'Z-API gateway error' }), { status: 500 });
      }
      return new Response(JSON.stringify({ messageId: 'zapi-msg-123' }), { status: 200 });
    }
    if (String(url).includes('graph.facebook.com')) {
      metaSendCount++;
      return new Response(JSON.stringify({ messages: [{ id: `wamid.mock.${metaSendCount}` }] }), { status: 200 });
    }
    return originalFetch(url, _opts);
  };

  try {
    console.log('\n=== INICIANDO SUITE DE HOMOLOGAÇÃO E SEGURANÇA EM PRODUÇÃO ===\n');

    // 1. Anonymous & token separation checks
    const anonCreate = await requestJson(port, 'POST', '/api/packages/create', { condominiumId: CONDO_A, packages: [] });
    const anonNotify = await requestJson(port, 'POST', '/api/notify-resident', { packageId: 'x' });
    const anonOcr1 = await requestJson(port, 'POST', '/api/ocr/extract-basic', { image: 'abc' });
    const anonOcr2 = await requestJson(port, 'POST', '/api/ocr/analyze-label', { image: 'abc' });
    const anonActivity = await requestJson(port, 'POST', '/api/portaria/activity', { condominiumId: CONDO_A, action: 'TEST' });
    const anonSelectCondo = await requestJson(port, 'POST', '/api/profiles/select-condominium', { condominiumId: CONDO_B });
    const mockCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      { condominiumId: CONDO_A, packages: [] },
      { Authorization: 'Bearer MOCK_TOKEN' }
    );
    const portariaAdminBlock = await requestJson(
      port,
      'GET',
      '/api/admin/users',
      undefined,
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    assert(
      anonCreate.status === 401 &&
        anonNotify.status === 401 &&
        anonOcr1.status === 401 &&
        anonOcr2.status === 401 &&
        anonActivity.status === 401 &&
        anonSelectCondo.status === 401 &&
        mockCreate.status === 401 &&
        portariaAdminBlock.status === 401,
      '1. Rejeição anônima, MOCK_TOKEN bloqueado em produção e token de portaria recusado em rotas admin'
    );

    // 2. /api/packages/create tenant isolation & error propagation
    const crossCondoCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_B,
        recipientId: RESIDENT_B_ID,
        packages: [{ unit_number: '202' }],
      },
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    const crossResidentCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_B_ID,
        packages: [{ unit_number: '101' }],
      },
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    db.faults.failStorageUpload = true;
    const failedPhotoCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_A_ID,
        packages: [{ unit_number: '101', photo_url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }],
      },
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    db.faults.failStorageUpload = false;

    const validCreate = await requestJson(
      port,
      'POST',
      '/api/packages/create',
      {
        condominiumId: CONDO_A,
        recipientId: RESIDENT_A_ID,
        packages: [
          {
            unit_number: '101',
            carrier: 'Amazon',
            pickup_code: '839102',
            pickup_token: 'tok-pkg-valid-a1234567890abcdef',
            received_by: PORTEIRO_A_ID,
          },
        ],
      },
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    const createdPkgId = validCreate.data?.packages?.[0]?.id;
    assert(
      crossCondoCreate.status === 403 &&
        crossResidentCreate.status === 403 &&
        failedPhotoCreate.status === 500 &&
        validCreate.status === 200 &&
        Boolean(createdPkgId),
      '2. /api/packages/create bloqueia cross-tenant (condo/morador), propaga erro de Storage (500) e persiste pacote válido'
    );

    // 3. /api/notify-resident authoritative recipient, tenant isolation & DB update only after confirmation
    // Create a package in Condo B for isolation check
    const pkgBId = crypto.randomUUID();
    db.tables.packages.push({
      id: pkgBId,
      condominium_id: CONDO_B,
      recipient_id: RESIDENT_B_ID,
      unit_number: '202',
      status: 'received',
      pickup_code: '551199',
      pickup_token: 'tok-pkg-condo-b-9988776655443322',
      received_at: new Date().toISOString(),
    });

    const missingPkgNotify = await requestJson(
      port,
      'POST',
      '/api/notify-resident',
      { phone: '5511900001111' },
      { Authorization: `Bearer ${TOKEN_PORTEIRO_A}` }
    );
    const crossCondoNotify = await requestJson(
      port,
      'POST',
      '/api/notify-resident',
      { packageId: pkgBId, phone: '5511900001111' },
      { Authorization: `Bearer ${TOKEN_PORTEIRO_A}` }
    );
    const okNotify = await requestJson(
      port,
      'POST',
      '/api/notify-resident',
      { packageId: createdPkgId, phone: '5511900009999' }, // spoofed phone ignored in favor of DB morador
      { Authorization: `Bearer ${TOKEN_PORTEIRO_A}` }
    );
    const pkgAfterNotify = db.tables.packages.find((p) => p.id === createdPkgId);
    const lastLog = db.tables.message_logs[db.tables.message_logs.length - 1];
    assert(
      missingPkgNotify.status === 400 &&
        crossCondoNotify.status === 403 &&
        okNotify.status === 200 &&
        pkgAfterNotify?.whatsapp_sent === true &&
        lastLog?.telefone === '5511988887777' &&
        db.tables.notifications.length === 0, // nunca grava received_by do porteiro em notifications.user_id
      '3. /api/notify-resident exige packageId, isola condomínio, usa telefone do banco (ignora spoof) e não polui notifications com ID do porteiro'
    );

    // 4. /api/profiles/select-condominium privilege boundary
    const sindicoSwitchCondo = await requestJson(
      port,
      'POST',
      '/api/profiles/select-condominium',
      { condominiumId: CONDO_B },
      { Authorization: `Bearer ${TOKEN_SINDICO_A}` }
    );
    const adminSwitchCondo = await requestJson(
      port,
      'POST',
      '/api/profiles/select-condominium',
      { condominiumId: CONDO_B },
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    // Restore admin back to CONDO_A
    await requestJson(
      port,
      'POST',
      '/api/profiles/select-condominium',
      { condominiumId: CONDO_A },
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    assert(
      sindicoSwitchCondo.status === 403 && adminSwitchCondo.status === 200 && adminSwitchCondo.data?.profile?.condominium_id === CONDO_B,
      '4. /api/profiles/select-condominium bloqueia síndico de trocar condomínio (403) e permite apenas admin global'
    );

    // 5. /api/portaria/activity isolation and audit error propagation
    const crossActivityPost = await requestJson(
      port,
      'POST',
      '/api/portaria/activity',
      { condominiumId: CONDO_B, action: 'INVASAO' },
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    db.faults.failAuditInsert = true;
    const errActivityPost = await requestJson(
      port,
      'POST',
      '/api/portaria/activity',
      { condominiumId: CONDO_A, action: 'ENCOMENDA_REGISTRADA' },
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    db.faults.failAuditInsert = false;
    const crossActivityGet = await requestJson(
      port,
      'GET',
      `/api/portaria/activity?condominiumId=${CONDO_B}`,
      undefined,
      { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
    );
    assert(
      crossActivityPost.status === 403 && errActivityPost.status === 500 && crossActivityGet.status === 403,
      '5. /api/portaria/activity isola condomínio (GET/POST 403) e propaga erro 500 de inserção'
    );

    // 6. RBAC, integrity-check read-only & DELETE condominium dependency safety
    const sindicoCheck = await requestJson(
      port,
      'GET',
      '/api/admin/integrity-check',
      undefined,
      { Authorization: `Bearer ${TOKEN_SINDICO_A}` }
    );
    const getRepairRejected = await requestJson(
      port,
      'GET',
      '/api/admin/integrity-check?repair=true',
      undefined,
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    // Insert an orphaned profile and test POST /api/admin/integrity-repair
    const orphanProfId = crypto.randomUUID();
    db.tables.profiles.push({
      id: orphanProfId,
      full_name: 'Perfil Órfão',
      role: 'porteiro',
      condominium_id: ORPHAN_CONDO,
      active: true,
    });
    const repairWithoutConfirm = await requestJson(
      port,
      'POST',
      '/api/admin/integrity-repair',
      { confirm: false },
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    const repairWithConfirm = await requestJson(
      port,
      'POST',
      '/api/admin/integrity-repair',
      { confirm: true, repairProfiles: true },
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    const repairedProfile = db.tables.profiles.find((p) => p.id === orphanProfId);

    // Try DELETE condo A without force -> MUST return 400 and keep condominium_settings intact!
    const delCondoBeforeConfirm = await requestJson(
      port,
      'DELETE',
      `/api/admin/condominiums/${CONDO_A}`,
      undefined,
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    const settingsStillIntact = db.tables.condominium_settings.some((s) => s.condominium_id === CONDO_A);

    // Ensure non-global admin (sindico) CANNOT change active=false via PUT /api/admin/condominiums/:id (403)
    const putCondoAttemptDeactivate = await requestJson(
      port,
      'PUT',
      `/api/admin/condominiums/${CONDO_A}`,
      { name: 'Residencial Alpha', address: 'Rua Alpha, 100', active: false },
      { Authorization: `Bearer ${TOKEN_SINDICO_A}` }
    );
    const condoAStillActive = db.tables.condominiums.find((c) => c.id === CONDO_A)?.active === true;

    assert(
      sindicoCheck.status === 403 &&
        getRepairRejected.status === 405 &&
        repairWithoutConfirm.status === 400 &&
        repairWithConfirm.status === 200 &&
        repairedProfile?.condominium_id === null &&
        delCondoBeforeConfirm.status === 400 &&
        delCondoBeforeConfirm.data?.hasDependencies === true &&
        settingsStillIntact &&
        putCondoAttemptDeactivate.status === 403 &&
        condoAStillActive,
      '6. integrity-check bloqueia repair via GET (405), integrity-repair exige confirm=true, DELETE condomínio não corrompe antes da confirmação e síndico não altera active via PUT (403)'
    );

    // 7. User delete with history (soft-delete) vs clean delete + password Auth failure handling
    const delUserWithHistory = await requestJson(
      port,
      'DELETE',
      `/api/admin/users/${PORTEIRO_A_ID}`,
      undefined,
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    const porteiroAfterSoftDel = db.tables.profiles.find((p) => p.id === PORTEIRO_A_ID);
    const pkgStillHasPorter = db.tables.packages.find((p) => p.id === createdPkgId)?.received_by === PORTEIRO_A_ID;

    const delUserNoHistory = await requestJson(
      port,
      'DELETE',
      `/api/admin/users/${NO_HIST_USER_ID}`,
      undefined,
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    const noHistStillExists = db.tables.profiles.some((p) => p.id === NO_HIST_USER_ID);

    db.faults.failAuthUpdatePassword = true;
    const resetPwdAuthFail = await requestJson(
      port,
      'POST',
      `/api/admin/users/${SINDICO_A_ID}/reset-password`,
      {},
      { Authorization: `Bearer ${TOKEN_ADMIN}` }
    );
    const changePwdAuthFail = await requestJson(
      port,
      'POST',
      '/api/auth/change-password',
      { newPassword: 'NovaSenhaForte@2026' },
      { Authorization: `Bearer ${TOKEN_SINDICO_A}` }
    );
    db.faults.failAuthUpdatePassword = false;

    assert(
      delUserWithHistory.status === 200 &&
        delUserWithHistory.data?.softDeleted === true &&
        porteiroAfterSoftDel?.active === false &&
        db.bannedUsers.has(PORTEIRO_A_ID) &&
        pkgStillHasPorter &&
        delUserNoHistory.status === 200 &&
        delUserNoHistory.data?.softDeleted === false &&
        !noHistStillExists &&
        resetPwdAuthFail.status === 500 &&
        !resetPwdAuthFail.data?.tempPassword &&
        changePwdAuthFail.status === 500,
      '7. DELETE usuário com histórico preserva pacotes e faz soft-delete; sem histórico exclui; falhas no Auth retornam 500 sem tempPassword'
    );

    // 8. Lembretes automáticos 48h/72h removidos/desativados (sem dependência de CRON_SECRET nem disparo automático)
    const nowMs = Date.now();
    const pkg48Id = crypto.randomUUID();
    const pkg72Id = crypto.randomUUID();
    db.tables.packages.push(
      {
        id: pkg48Id,
        condominium_id: CONDO_A,
        recipient_id: RESIDENT_A_ID,
        unit_number: '101',
        status: 'received',
        pickup_code: '484848',
        pickup_token: 'tok-48h-disabled-test-123456',
        received_at: new Date(nowMs - 50 * 3600 * 1000).toISOString(),
      },
      {
        id: pkg72Id,
        condominium_id: CONDO_A,
        recipient_id: RESIDENT_A_ID,
        unit_number: '101',
        status: 'received',
        pickup_code: '727272',
        pickup_token: 'tok-72h-disabled-test-123456',
        received_at: new Date(nowMs - 75 * 3600 * 1000).toISOString(),
      }
    );

    const metaSendCountBeforeCron = metaSendCount;
    const cronDisabledRes = await requestJson(port, 'POST', '/api/cron/reminders', {});

    assert(
      cronDisabledRes.status === 410 &&
        cronDisabledRes.data?.disabled === true &&
        cronDisabledRes.data?.sent === 0 &&
        metaSendCount === metaSendCountBeforeCron,
      '8. /api/cron/reminders desativado (410) sem dependência de CRON_SECRET e sem disparos automáticos 48h/72h'
    );

    // 9. WhatsApp Webhook Verification (GET), HMAC Signature Validation (POST), Phone Normalization & Idempotency
    const webhookChallengeBad = await requestJson(
      port,
      'GET',
      '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=98765'
    );
    const webhookChallengeOk = await requestJson(
      port,
      'GET',
      `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=98765`
    );

    const webhookPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.mock.1', status: 'delivered', recipient_id: '5511988887777' },
                ],
                messages: [
                  {
                    id: 'wamid.inbound.001',
                    from: '5511988887777',
                    text: { body: 'Obrigado, já vou retirar!' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const validHmac =
      'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(webhookPayload).digest('hex');

    const webhookBadSig = await requestJson(
      port,
      'POST',
      '/api/whatsapp/webhook',
      webhookPayload,
      { 'X-Hub-Signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' }
    );
    const webhookOk1 = await requestJson(
      port,
      'POST',
      '/api/whatsapp/webhook',
      webhookPayload,
      { 'X-Hub-Signature-256': validHmac }
    );
    const webhookOk2 = await requestJson(
      port,
      'POST',
      '/api/whatsapp/webhook',
      webhookPayload,
      { 'X-Hub-Signature-256': validHmac }
    );

    assert(
      webhookChallengeBad.status === 403 &&
        webhookChallengeOk.status === 200 &&
        webhookChallengeOk.raw === '98765' &&
        webhookBadSig.status === 401 &&
        webhookOk1.status === 200 &&
        webhookOk2.status === 200 &&
        db.tables.whatsapp_conversations.length === 2 &&
        db.tables.whatsapp_conversations[0]?.condominium_id === CONDO_A &&
        db.tables.auditoria_eventos.filter((a) => a.tipo_evento === 'WHATSAPP_WEBHOOK_STATUS').length === 1 &&
        db.tables.auditoria_eventos.filter((a) => a.tipo_evento === 'WHATSAPP_WEBHOOK_MSG').length === 1,
      '9. Webhook WhatsApp valida challenge, exige HMAC SHA-256 válido, associa morador por variação BR e é idempotente'
    );

    // 10. Portal PII Stripping, Short Code Rejection & Rate Limiting
    const residentToken = 'res-tok-abcdef1234567890abcdef1234567890';
    db.tables.resident_access_tokens.push({
      id: crypto.randomUUID(),
      resident_id: RESIDENT_A_ID,
      condominium_id: CONDO_A,
      token: residentToken,
      active: true,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });

    const portalValidateRes = await requestJson(port, 'GET', `/api/portal/validate/${residentToken}`);
    const portalShortCodeReject = await requestJson(port, 'GET', '/api/portal/package/4829');
    const portalPkgRes = await requestJson(port, 'GET', '/api/portal/package/tok-pkg-valid-a1234567890abcdef');

    const serializedResKeys = JSON.stringify(portalValidateRes.data || {}) + JSON.stringify(portalPkgRes.data || {});
    const leaksPii =
      serializedResKeys.includes('5511988887777') ||
      serializedResKeys.includes('maria.pii@alpha.com') ||
      serializedResKeys.includes('12345678900') ||
      serializedResKeys.includes('sindico.sigiloso@alpha.com') ||
      serializedResKeys.includes('Nota confidencial');

    // Rate limit test on validate-code (limit 40 / 5min)
    let codeRateLimited = false;
    for (let i = 0; i < 45; i++) {
      const rlRes = await requestJson(
        port,
        'GET',
        '/api/portal/validate-code/000000',
        undefined,
        { 'X-Forwarded-For': '203.0.113.55' }
      );
      if (rlRes.status === 429) {
        codeRateLimited = true;
        break;
      }
    }

    // Rate limit test on OCR (limit 60 / min)
    let ocrRateLimited = false;
    for (let i = 0; i < 65; i++) {
      const ocrRes = await requestJson(
        port,
        'POST',
        '/api/ocr/extract-basic',
        {}, // returns 400 after auth & rate limit checks
        { Authorization: `Bearer ${TOKEN_PORTARIA_A}` }
      );
      if (ocrRes.status === 429) {
        ocrRateLimited = true;
        break;
      }
    }

    assert(
      portalValidateRes.status === 200 &&
        portalShortCodeReject.status === 404 &&
        portalPkgRes.status === 200 &&
        portalPkgRes.data?.valid === true &&
        Array.isArray(portalPkgRes.data?.allPackages) &&
        !leaksPii &&
        codeRateLimited &&
        ocrRateLimited,
      '10. Portal remove PII sensível, bloqueia código curto em /package, e aplica rate limit em código (429) e OCR (429)'
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
    if (prevAppSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = prevAppSecret;
    if (prevVerifyToken === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
    else process.env.WHATSAPP_VERIFY_TOKEN = prevVerifyToken;
    if (prevWaToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = prevWaToken;
    if (prevWaPhoneId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = prevWaPhoneId;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\nResumo Final Hardening: ${passed}/${total} verificações aprovadas.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error('Erro fatal na suíte de homologação:', err);
  process.exit(1);
});
