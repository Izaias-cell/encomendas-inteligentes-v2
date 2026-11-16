/**
 * SUITE COMPLETA DE HOMOLOGAÇÃO:
 * AUTENTICAÇÃO, CREDENCIAIS E SESSÕES DA PORTARIA + SESSÃO ADMIN
 *
 * Cobre todos os 17 cenários críticos da auditoria (ETAPA 12):
 * 1. Preservação de portaria_access_code já existente no banco
 * 2. Falha em consulta ao banco NÃO trata erro como ausência e NÃO gera novo código
 * 3. Falha em gravação de credencial retorna erro real (500) e NÃO atualiza memória
 * 4. Ativação (/api/portaria/activate) com código válido de condomínio ativo (somente leitura)
 * 5. Recusa de ativação para condomínio inativo (403)
 * 6. Criação de sessão (/api/portaria/confirm-link) com persistência confirmada no banco
 * 7. Falha de persistência na criação de sessão retorna erro real e NÃO aceita em memória
 * 8. Validação de token ativo (/api/portaria/validate-token/:token)
 * 9. Rejeição de token inexistente (401 PORTARIA_DEACTIVATED)
 * 10. Rejeição de token revogado mesmo com cache em outra instância
 * 11. Inativação de condomínio revoga token no DB (com rollback compensatório se revogação falhar)
 * 12. Reativação mantém token revogado (null), preserva código e exige nova autenticação
 * 13. Regeneração administrativa gera código único, revoga token antigo e respeita escopo
 * 14. Porteiro / morador / perfil ausente / inativo recusado em rotas administrativas (403)
 * 15. Rejeição estrita de MOCK_TOKEN em produção e falha real em token inválido (401)
 * 16. Persistência e limpeza unificada no frontend (apiClient.ts / App.tsx) + detecção de 401
 * 17. Consistência após reinicialização de servidor / múltiplas instâncias serverless
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

// Prevent server.ts auto-start on port 3000 during isolated HTTP test execution
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

interface FaultFlags {
  failSettingsSelect: boolean;
  failSettingsSelectByCondo: boolean;
  failSettingsWrite: boolean;
  failSettingsRevokeOnStatus: boolean;
  failAuditInsert: boolean;
  enforceUniqueCode: boolean;
}

class MockSupabaseDB {
  tables: Record<string, Row[]> = {
    condominiums: [],
    condominium_settings: [],
    profiles: [],
    moradores: [],
    packages: [],
    auditoria_eventos: [],
  };

  authUsers: Map<string, { id: string; email: string }> = new Map();
  faults: FaultFlags = {
    failSettingsSelect: false,
    failSettingsSelectByCondo: false,
    failSettingsWrite: false,
    failSettingsRevokeOnStatus: false,
    failAuditInsert: false,
    enforceUniqueCode: true,
  };

  resetFaults() {
    this.faults.failSettingsSelect = false;
    this.faults.failSettingsSelectByCondo = false;
    this.faults.failSettingsWrite = false;
    this.faults.failSettingsRevokeOnStatus = false;
    this.faults.failAuditInsert = false;
    this.faults.enforceUniqueCode = true;
  }

  createClient() {
    const db = this;

    const makeQueryBuilder = (table: string) => {
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let insertPayload: Row[] = [];
      let updatePatch: Row = {};
      const filters: Array<(row: Row) => boolean> = [];
      let hasCondoIdEqFilter = false;
      let orderCol: string | null = null;
      let orderAsc = true;
      let singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
      let selectWasCalledAfterMutation = false;

      const execute = async (): Promise<{ data: any; error: any; count?: number }> => {
        if (!db.tables[table]) {
          db.tables[table] = [];
        }

        if (mode === 'select') {
          if (table === 'condominium_settings') {
            if (db.faults.failSettingsSelect) {
              return { data: null, error: { message: 'Simulated DB timeout reading condominium_settings' } };
            }
            if (db.faults.failSettingsSelectByCondo && hasCondoIdEqFilter) {
              return { data: null, error: { message: 'Simulated DB error reading settings by condominium_id' } };
            }
          }

          let rows = db.tables[table].filter((r) => filters.every((fn) => fn(r))).map((r) => ({ ...r }));
          if (orderCol) {
            rows.sort((a, b) => {
              const av = a[orderCol!] ?? '';
              const bv = b[orderCol!] ?? '';
              if (av < bv) return orderAsc ? -1 : 1;
              if (av > bv) return orderAsc ? 1 : -1;
              return 0;
            });
          }

          if (singleMode === 'maybeSingle') {
            return { data: rows[0] ?? null, error: null };
          }
          if (singleMode === 'single') {
            if (rows.length !== 1) {
              return { data: null, error: { message: `Expected 1 row, found ${rows.length}` } };
            }
            return { data: rows[0], error: null };
          }
          return { data: rows, error: null, count: rows.length };
        }

        if (mode === 'insert') {
          if (table === 'auditoria_eventos' && db.faults.failAuditInsert) {
            return { data: null, error: { message: 'Simulated audit log insert failure' } };
          }
          if (table === 'condominium_settings' && db.faults.failSettingsWrite) {
            return { data: null, error: { message: 'Simulated DB failure writing condominium_settings' } };
          }

          const inserted: Row[] = [];
          for (const rawRow of insertPayload) {
            const newRow: Row = {
              id: rawRow.id || `gen-${Math.random().toString(36).slice(2, 10)}`,
              created_at: rawRow.created_at || new Date().toISOString(),
              ...rawRow,
            };

            if (table === 'condominium_settings' && db.faults.enforceUniqueCode) {
              const duplicateCondo = db.tables.condominium_settings.some(
                (r) => r.condominium_id === newRow.condominium_id
              );
              const duplicateCode =
                newRow.portaria_access_code &&
                db.tables.condominium_settings.some(
                  (r) =>
                    r.portaria_access_code &&
                    String(r.portaria_access_code).toUpperCase() === String(newRow.portaria_access_code).toUpperCase()
                );
              if (duplicateCondo || duplicateCode) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                };
              }
            }

            db.tables[table].push(newRow);
            inserted.push({ ...newRow });
          }

          if (!selectWasCalledAfterMutation) {
            return { data: null, error: null };
          }
          if (singleMode === 'single') {
            return { data: inserted[0] ?? null, error: inserted[0] ? null : { message: 'No row returned' } };
          }
          if (singleMode === 'maybeSingle') {
            return { data: inserted[0] ?? null, error: null };
          }
          return { data: inserted, error: null };
        }

        if (mode === 'update') {
          if (table === 'condominium_settings') {
            if (db.faults.failSettingsRevokeOnStatus && updatePatch.active_portaria_token === null) {
              return { data: null, error: { message: 'Simulated DB failure revoking active_portaria_token' } };
            }
            if (db.faults.failSettingsWrite) {
              return { data: null, error: { message: 'Simulated DB failure updating condominium_settings' } };
            }
          }

          const matchedIndices: number[] = [];
          db.tables[table].forEach((row, idx) => {
            if (filters.every((fn) => fn(row))) {
              matchedIndices.push(idx);
            }
          });

          const updatedRows: Row[] = [];
          for (const idx of matchedIndices) {
            const candidate = { ...db.tables[table][idx], ...updatePatch };
            if (table === 'condominium_settings' && db.faults.enforceUniqueCode && candidate.portaria_access_code) {
              const dupCode = db.tables.condominium_settings.some(
                (r, rIdx) =>
                  rIdx !== idx &&
                  r.portaria_access_code &&
                  String(r.portaria_access_code).toUpperCase() === String(candidate.portaria_access_code).toUpperCase()
              );
              if (dupCode) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                };
              }
            }
            db.tables[table][idx] = candidate;
            updatedRows.push({ ...candidate });
          }

          if (!selectWasCalledAfterMutation) {
            return { data: null, error: null };
          }
          if (singleMode === 'single') {
            if (updatedRows.length !== 1) {
              return { data: null, error: { message: `Expected 1 updated row, got ${updatedRows.length}` } };
            }
            return { data: updatedRows[0], error: null };
          }
          if (singleMode === 'maybeSingle') {
            return { data: updatedRows[0] ?? null, error: null };
          }
          return { data: updatedRows, error: null };
        }

        if (mode === 'delete') {
          const remaining: Row[] = [];
          const removed: Row[] = [];
          for (const r of db.tables[table]) {
            if (filters.every((fn) => fn(r))) {
              removed.push(r);
            } else {
              remaining.push(r);
            }
          }
          db.tables[table] = remaining;
          return { data: selectWasCalledAfterMutation ? removed : null, error: null };
        }

        return { data: null, error: null };
      };

      const builder: any = {
        select(_cols?: string, _opts?: any) {
          if (mode === 'insert' || mode === 'update' || mode === 'delete') {
            selectWasCalledAfterMutation = true;
          } else {
            mode = 'select';
          }
          return builder;
        },
        insert(payload: Row | Row[]) {
          mode = 'insert';
          insertPayload = Array.isArray(payload) ? payload : [payload];
          return builder;
        },
        update(patch: Row) {
          mode = 'update';
          updatePatch = patch;
          return builder;
        },
        delete() {
          mode = 'delete';
          return builder;
        },
        eq(col: string, val: any) {
          if (col === 'condominium_id') hasCondoIdEqFilter = true;
          filters.push((r) => r[col] === val);
          return builder;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return builder;
        },
        ilike(col: string, pattern: string) {
          const clean = String(pattern || '').toLowerCase();
          filters.push((r) => String(r[col] || '').toLowerCase() === clean);
          return builder;
        },
        not(col: string, op: string, val: any) {
          if (op === 'is' && val === null) {
            filters.push((r) => r[col] !== null && r[col] !== undefined);
          }
          return builder;
        },
        in(col: string, vals: any[]) {
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        maybeSingle() {
          singleMode = 'maybeSingle';
          return builder;
        },
        single() {
          singleMode = 'single';
          return builder;
        },
        then(onFulfilled: (val: any) => any, onRejected?: (err: any) => any) {
          return execute().then(onFulfilled, onRejected);
        },
      };

      return builder;
    };

    return {
      from: (table: string) => makeQueryBuilder(table),
      auth: {
        getUser: async (token: string) => {
          const user = db.authUsers.get(token);
          if (!user) {
            return { data: { user: null }, error: { message: 'Invalid JWT' } };
          }
          return { data: { user }, error: null };
        },
        admin: {
          listUsers: async () => ({
            data: { users: Array.from(db.authUsers.values()) },
            error: null,
          }),
          createUser: async ({ email, user_metadata }: any) => {
            const id = `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`;
            return { data: { user: { id, email, user_metadata } }, error: null };
          },
          updateUserById: async () => ({ data: { user: null }, error: null }),
          deleteUser: async () => ({ error: null }),
          signOut: async () => ({ error: null }),
        },
      },
      storage: {
        listBuckets: async () => ({ data: [{ name: 'packages' }], error: null }),
      },
    };
  }
}

async function startTestServer(app: any): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((resClose) => server.close(() => resClose())),
      });
    });
  });
}

async function jsonReq(baseUrl: string, method: string, route: string, body?: any, token?: string) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, data };
}

async function runTests() {
  console.log('\n================================================================');
  console.log('🔐 TESTES REAIS: CREDENCIAIS, SESSÕES DA PORTARIA E ADMIN AUTH');
  console.log('================================================================\n');

  const { createApp } = await import('../../server');

  const db = new MockSupabaseDB();
  const mockClient = db.createClient();

  const CONDO_A_ID = '11111111-1111-4111-8111-111111111111';
  const CONDO_B_ID = '22222222-2222-4222-8222-222222222222';
  const CONDO_INACTIVE_ID = '33333333-3333-4333-8333-333333333333';

  const ADMIN_ID = 'aaaa1111-1111-4111-8111-111111111111';
  const SINDICO_A_ID = 'bbbb2222-2222-4222-8222-222222222222';
  const PORTEIRO_A_ID = 'cccc3333-3333-4333-8333-333333333333';
  const INACTIVE_ADMIN_ID = 'dddd4444-4444-4444-8444-444444444444';
  const NO_PROFILE_USER_ID = 'eeee5555-5555-4555-8555-555555555555';
  const EMPTY_ROLE_USER_ID = 'ffff6666-6666-4666-8666-666666666666';

  const ADMIN_TOKEN = 'jwt-admin-global';
  const SINDICO_A_TOKEN = 'jwt-sindico-condo-a';
  const PORTEIRO_A_TOKEN = 'jwt-porteiro-a';
  const INACTIVE_ADMIN_TOKEN = 'jwt-admin-inativo';
  const NO_PROFILE_TOKEN = 'jwt-sem-perfil';
  const EMPTY_ROLE_TOKEN = 'jwt-role-vazio';

  db.authUsers.set(ADMIN_TOKEN, { id: ADMIN_ID, email: 'admin@condo.test' });
  db.authUsers.set(SINDICO_A_TOKEN, { id: SINDICO_A_ID, email: 'sindicoa@condo.test' });
  db.authUsers.set(PORTEIRO_A_TOKEN, { id: PORTEIRO_A_ID, email: 'porteiroa@condo.test' });
  db.authUsers.set(INACTIVE_ADMIN_TOKEN, { id: INACTIVE_ADMIN_ID, email: 'inativo@condo.test' });
  db.authUsers.set(NO_PROFILE_TOKEN, { id: NO_PROFILE_USER_ID, email: 'semperfil@condo.test' });
  db.authUsers.set(EMPTY_ROLE_TOKEN, { id: EMPTY_ROLE_USER_ID, email: 'semrole@condo.test' });

  db.tables.condominiums.push(
    { id: CONDO_A_ID, name: 'Condomínio Aurora', address: 'Rua das Flores, 10', active: true },
    { id: CONDO_B_ID, name: 'Condomínio Brisa', address: 'Av. Central, 200', active: true },
    { id: CONDO_INACTIVE_ID, name: 'Condomínio Bloqueado', address: 'Rua Fechada, 99', active: false }
  );

  // Condo A already has a persisted code; Condo B starts WITHOUT settings row; Condo Inactive has a code
  db.tables.condominium_settings.push(
    {
      condominium_id: CONDO_A_ID,
      portaria_name: 'Condomínio Aurora',
      portaria_access_code: 'AURORA-1010',
      active_portaria_token: null,
    },
    {
      condominium_id: CONDO_INACTIVE_ID,
      portaria_name: 'Condomínio Bloqueado',
      portaria_access_code: 'BLOQ-9090',
      active_portaria_token: null,
    }
  );

  db.tables.profiles.push(
    { id: ADMIN_ID, full_name: 'Admin Master', role: 'admin', condominium_id: null, active: true },
    { id: SINDICO_A_ID, full_name: 'Síndico Aurora', role: 'sindico', condominium_id: CONDO_A_ID, active: true },
    { id: PORTEIRO_A_ID, full_name: 'João Porteiro', role: 'porteiro', condominium_id: CONDO_A_ID, active: true },
    { id: INACTIVE_ADMIN_ID, full_name: 'Admin Desativado', role: 'admin', condominium_id: null, active: false },
    { id: EMPTY_ROLE_USER_ID, full_name: 'Perfil Sem Role', role: '', condominium_id: CONDO_A_ID, active: true }
  );

  const instance1 = await startTestServer(createApp({ supabase: mockClient, supabaseAdmin: mockClient, isProduction: true }));
  const instance2 = await startTestServer(createApp({ supabase: mockClient, supabaseAdmin: mockClient, isProduction: true }));

  try {
    // -------------------------------------------------------------------------
    // Cenário 15 (Admin Auth + MOCK_TOKEN + fallback inseguro)
    // -------------------------------------------------------------------------
    const prevAllowMock = process.env.ALLOW_TEST_MOCK_AUTH;
    process.env.ALLOW_TEST_MOCK_AUTH = 'true'; // Must STILL be rejected when isProduction: true
    const mockAdminRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, 'MOCK_TOKEN');
    process.env.ALLOW_TEST_MOCK_AUTH = prevAllowMock;
    assert(
      mockAdminRes.status === 401,
      '15a. MOCK_TOKEN é recusado com HTTP 401 em produção mesmo com ALLOW_TEST_MOCK_AUTH=true'
    );

    const mockCreateCondoRes = await jsonReq(
      instance1.baseUrl,
      'POST',
      '/api/condominiums/create',
      { name: 'Inválido' },
      'MOCK_TOKEN'
    );
    assert(mockCreateCondoRes.status === 401, '15b. POST /api/condominiums/create recusa MOCK_TOKEN com HTTP 401');

    const invalidBearerRes = await jsonReq(
      instance1.baseUrl,
      'GET',
      '/api/admin/condominiums',
      undefined,
      'token-jwt-falso-invalido'
    );
    assert(
      invalidBearerRes.status === 401,
      '15c. Token inválido/expirado no Supabase Auth retorna HTTP 401 (sem fallback para outro admin)'
    );

    const mockChangePwdRes = await jsonReq(
      instance1.baseUrl,
      'POST',
      '/api/auth/change-password',
      { newPassword: 'NovaSenha123', userId: ADMIN_ID },
      'MOCK_TOKEN'
    );
    assert(mockChangePwdRes.status === 401, '15d. POST /api/auth/change-password recusa MOCK_TOKEN com HTTP 401');

    // -------------------------------------------------------------------------
    // Cenário 14 (Porteiro, usuário sem perfil, role vazio, admin inativo -> 403)
    // -------------------------------------------------------------------------
    const porteiroListRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, PORTEIRO_A_TOKEN);
    const porteiroRegenRes = await jsonReq(
      instance1.baseUrl,
      'POST',
      `/api/admin/condominiums/${CONDO_A_ID}/regenerate-portaria-code`,
      {},
      PORTEIRO_A_TOKEN
    );
    const porteiroStatusRes = await jsonReq(
      instance1.baseUrl,
      'PATCH',
      `/api/admin/condominiums/${CONDO_A_ID}/status`,
      { active: false },
      PORTEIRO_A_TOKEN
    );
    const noProfileRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, NO_PROFILE_TOKEN);
    const emptyRoleRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, EMPTY_ROLE_TOKEN);
    const inactiveAdminRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, INACTIVE_ADMIN_TOKEN);

    assert(
      porteiroListRes.status === 403 &&
        porteiroRegenRes.status === 403 &&
        porteiroStatusRes.status === 403 &&
        noProfileRes.status === 403 &&
        emptyRoleRes.status === 403 &&
        inactiveAdminRes.status === 403,
      '14. Porteiro, usuário sem perfil, role vazio e admin inativo são bloqueados com HTTP 403 nas rotas administrativas'
    );

    // -------------------------------------------------------------------------
    // Cenário 2 e 3: Falhas de DB na consulta e na gravação de credenciais
    // -------------------------------------------------------------------------
    db.faults.failSettingsSelect = true;
    const dbReadFailRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, ADMIN_TOKEN);
    assert(
      dbReadFailRes.status === 500 &&
        db.tables.condominium_settings.filter((s) => s.condominium_id === CONDO_B_ID).length === 0,
      '2a. Falha na consulta em lote de condominium_settings retorna HTTP 500 e NÃO gera código novo para Condo B'
    );
    db.resetFaults();

    // Batch read succeeds, but getOrInitPortariaCreds select fails for Condo B
    db.faults.failSettingsSelectByCondo = true;
    const dbInitReadFailRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, ADMIN_TOKEN);
    assert(
      dbInitReadFailRes.status === 500 &&
        db.tables.condominium_settings.filter((s) => s.condominium_id === CONDO_B_ID).length === 0,
      '2b. Falha na consulta em getOrInitPortariaCreds retorna HTTP 500 e NÃO trata erro como ausência'
    );
    db.resetFaults();

    // DB write fails when persisting generated credential for Condo B
    db.faults.failSettingsWrite = true;
    const dbWriteFailRes = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, ADMIN_TOKEN);
    assert(
      dbWriteFailRes.status === 500 &&
        db.tables.condominium_settings.filter((s) => s.condominium_id === CONDO_B_ID).length === 0,
      '3. Falha ao persistir novo código no DB retorna HTTP 500 sem falso sucesso nem registro em memória'
    );
    db.resetFaults();

    // -------------------------------------------------------------------------
    // Cenário 1: Condomínio já possui código -> preservado; Condo B recebe novo único
    // -------------------------------------------------------------------------
    const listOkRes1 = await jsonReq(instance1.baseUrl, 'GET', '/api/admin/condominiums', undefined, ADMIN_TOKEN);
    const listOkRes2 = await jsonReq(instance2.baseUrl, 'GET', '/api/admin/condominiums', undefined, ADMIN_TOKEN);
    const condoAFromApi1 = listOkRes1.data?.condominiums?.find((c: any) => c.id === CONDO_A_ID);
    const condoAFromApi2 = listOkRes2.data?.condominiums?.find((c: any) => c.id === CONDO_A_ID);
    const condoBFromApi1 = listOkRes1.data?.condominiums?.find((c: any) => c.id === CONDO_B_ID);
    const condoBFromApi2 = listOkRes2.data?.condominiums?.find((c: any) => c.id === CONDO_B_ID);

    assert(
      listOkRes1.status === 200 &&
        condoAFromApi1?.portaria_access_code === 'AURORA-1010' &&
        condoAFromApi2?.portaria_access_code === 'AURORA-1010' &&
        Boolean(condoBFromApi1?.portaria_access_code) &&
        condoBFromApi1?.portaria_access_code === condoBFromApi2?.portaria_access_code &&
        condoBFromApi1?.portaria_access_code !== 'AURORA-1010',
      '1. Código existente (AURORA-1010) é preservado em múltiplas instâncias e novo código gerado para Condo B persiste igualmente'
    );

    // -------------------------------------------------------------------------
    // Cenário 4 e 5: /api/portaria/activate (somente leitura)
    // -------------------------------------------------------------------------
    const activateActiveRes = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: ' aurora-1010 ',
    });
    const settingAAfterActivate = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    assert(
      activateActiveRes.status === 200 &&
        activateActiveRes.data?.success === true &&
        activateActiveRes.data?.condominium?.id === CONDO_A_ID &&
        settingAAfterActivate?.portaria_access_code === 'AURORA-1010' &&
        settingAAfterActivate?.active_portaria_token === null,
      '4. POST /api/portaria/activate valida código de condomínio ativo em modo somente leitura (sem mutar código/sessão)'
    );

    const activateWrongCodeRes = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: 'INEXISTENTE-9999',
    });
    assert(activateWrongCodeRes.status === 404, '4b. POST /api/portaria/activate com código inexistente retorna HTTP 404 sem gerar código');

    const activateInactiveRes = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: 'BLOQ-9090',
    });
    assert(
      activateInactiveRes.status === 403,
      '5. POST /api/portaria/activate recusa código de condomínio inativo com HTTP 403'
    );

    // -------------------------------------------------------------------------
    // Cenário 7: Banco indisponível na criação de sessão (/confirm-link)
    // -------------------------------------------------------------------------
    db.faults.failSettingsWrite = true;
    const confirmFailRes = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/confirm-link', {
      access_code: 'AURORA-1010',
    });
    db.resetFaults();
    const settingAAfterFailConfirm = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    assert(
      confirmFailRes.status === 500 &&
        !confirmFailRes.data?.success &&
        !confirmFailRes.data?.portaria_token &&
        settingAAfterFailConfirm?.active_portaria_token === null,
      '7. POST /api/portaria/confirm-link com falha de persistência no DB retorna HTTP 500 e NÃO grava sessão'
    );

    // -------------------------------------------------------------------------
    // Cenário 6 & 8 & 17a: Criação de sessão + validação em outra instância
    // -------------------------------------------------------------------------
    const confirmOkRes = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/confirm-link', {
      access_code: 'AURORA-1010',
    });
    const token1 = confirmOkRes.data?.portaria_token;
    const dbTokenRow = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    assert(
      confirmOkRes.status === 200 &&
        confirmOkRes.data?.success === true &&
        typeof token1 === 'string' &&
        /^[0-9a-f]{64}$/.test(token1) &&
        dbTokenRow?.active_portaria_token === token1 &&
        Array.isArray(confirmOkRes.data?.porters) &&
        confirmOkRes.data.porters.length === 1,
      '6. POST /api/portaria/confirm-link gera token criptográfico de 64 hex chars e confirma persistência no DB'
    );

    const validateOkInst1 = await jsonReq(instance1.baseUrl, 'GET', `/api/portaria/validate-token/${token1}`);
    const validateOkInst2 = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token1}`);
    assert(
      validateOkInst1.status === 200 &&
        validateOkInst1.data?.success === true &&
        validateOkInst2.status === 200 &&
        validateOkInst2.data?.condominium?.id === CONDO_A_ID,
      '8 & 17a. GET /api/portaria/validate-token/:token autoriza token ativo na instância original e em nova instância sem cache prévio'
    );

    // -------------------------------------------------------------------------
    // Cenário 9: Token inexistente
    // -------------------------------------------------------------------------
    const validateMissingRes = await jsonReq(instance1.baseUrl, 'GET', '/api/portaria/validate-token/token-que-nao-existe');
    assert(
      validateMissingRes.status === 401 && validateMissingRes.data?.code === 'PORTARIA_DEACTIVATED',
      '9. GET /api/portaria/validate-token/:token recusa token inexistente com 401 PORTARIA_DEACTIVATED'
    );

    // -------------------------------------------------------------------------
    // Cenário 10: Token revogado (substituído) recusado inclusive na instância 2 com cache quente
    // -------------------------------------------------------------------------
    const confirmReplaceRes = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/confirm-link', {
      access_code: 'AURORA-1010',
    });
    const token2 = confirmReplaceRes.data?.portaria_token;
    // Instance 2 previously cached token1 in its own portariaStore! It MUST still consult DB and reject token1:
    const validateStaleToken1OnInst2 = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token1}`);
    const validateToken2OnInst2 = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token2}`);
    assert(
      token2 &&
        token2 !== token1 &&
        validateStaleToken1OnInst2.status === 401 &&
        validateStaleToken1OnInst2.data?.code === 'PORTARIA_DEACTIVATED' &&
        validateToken2OnInst2.status === 200,
      '10. Token antigo (token1) substituído por nova sessão é recusado com 401 mesmo em instância secundária que o possuía em cache'
    );

    // -------------------------------------------------------------------------
    // Cenário 11: Inativação de condomínio + falha de revogação com rollback
    // -------------------------------------------------------------------------
    // First test Síndico trying to change status -> must be 403 (global admin only)
    const sindicoStatusRes = await jsonReq(
      instance1.baseUrl,
      'PATCH',
      `/api/admin/condominiums/${CONDO_A_ID}/status`,
      { active: false },
      SINDICO_A_TOKEN
    );
    assert(sindicoStatusRes.status === 403, '11a. Síndico NÃO pode inativar/ativar condomínio (HTTP 403)');

    // Inject failure when revoking active_portaria_token during inactivation -> expects 500 + rollback active=true
    db.faults.failSettingsRevokeOnStatus = true;
    const inactivateRollbackRes = await jsonReq(
      instance1.baseUrl,
      'PATCH',
      `/api/admin/condominiums/${CONDO_A_ID}/status`,
      { active: false },
      ADMIN_TOKEN
    );
    db.resetFaults();
    const condoAAfterRollback = db.tables.condominiums.find((c) => c.id === CONDO_A_ID);
    const settingsAAfterRollback = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    assert(
      inactivateRollbackRes.status === 500 &&
        condoAAfterRollback?.active === true &&
        settingsAAfterRollback?.active_portaria_token === token2,
      '11b. Se falhar a revogação de sessão no DB durante inativação, retorna 500 e reverte condominiums.active para true'
    );

    // Now perform real inactivation
    const inactivateOkRes = await jsonReq(
      instance1.baseUrl,
      'PATCH',
      `/api/admin/condominiums/${CONDO_A_ID}/status`,
      { active: false },
      ADMIN_TOKEN
    );
    const condoAInactive = db.tables.condominiums.find((c) => c.id === CONDO_A_ID);
    const settingsAInactive = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    const validateAfterInactivateInst2 = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token2}`);
    assert(
      inactivateOkRes.status === 200 &&
        condoAInactive?.active === false &&
        settingsAInactive?.active_portaria_token === null &&
        validateAfterInactivateInst2.status === 401 &&
        validateAfterInactivateInst2.data?.code === 'PORTARIA_DEACTIVATED',
      '11c. Inativação de condomínio grava active=false, revoga active_portaria_token=null e recusa token2 com 401'
    );

    // -------------------------------------------------------------------------
    // Cenário 12: Reativação de condomínio preserva código, mantém token revogado e exige nova auth
    // -------------------------------------------------------------------------
    const reactivateRes = await jsonReq(
      instance1.baseUrl,
      'PATCH',
      `/api/admin/condominiums/${CONDO_A_ID}/status`,
      { active: true },
      ADMIN_TOKEN
    );
    const settingsAReactivated = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    const validateOldTokenAfterReactivate = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token2}`);
    const activateAfterReactivate = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: 'AURORA-1010',
    });
    const confirmAfterReactivate = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/confirm-link', {
      access_code: 'AURORA-1010',
    });
    const token3 = confirmAfterReactivate.data?.portaria_token;
    const validateToken3 = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token3}`);

    assert(
      reactivateRes.status === 200 &&
        settingsAReactivated?.portaria_access_code === 'AURORA-1010' &&
        settingsAReactivated?.active_portaria_token === null &&
        validateOldTokenAfterReactivate.status === 401 &&
        activateAfterReactivate.status === 200 &&
        confirmAfterReactivate.status === 200 &&
        Boolean(token3 && token3 !== token2) &&
        validateToken3.status === 200,
      '12. Reativação preserva código AURORA-1010, mantém token antigo revogado (401) e exige nova vinculação da Portaria'
    );

    // -------------------------------------------------------------------------
    // Cenário 13: Regeneração administrativa de código + escopo de Síndico + falha de DB
    // -------------------------------------------------------------------------
    // Síndico A trying to regenerate code of Condo B -> 403
    const sindicoOtherCondoRegen = await jsonReq(
      instance1.baseUrl,
      'POST',
      `/api/admin/condominiums/${CONDO_B_ID}/regenerate-portaria-code`,
      {},
      SINDICO_A_TOKEN
    );
    assert(
      sindicoOtherCondoRegen.status === 403,
      '13a. Síndico do Condomínio A é impedido de regenerar código do Condomínio B (HTTP 403)'
    );

    // Inject DB failure on regenerate -> keeps AURORA-1010 intact
    db.faults.failSettingsWrite = true;
    const regenDbFailRes = await jsonReq(
      instance1.baseUrl,
      'POST',
      `/api/admin/condominiums/${CONDO_A_ID}/regenerate-portaria-code`,
      {},
      ADMIN_TOKEN
    );
    db.resetFaults();
    const codeAfterRegenFail = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID)?.portaria_access_code;
    assert(
      regenDbFailRes.status === 500 && codeAfterRegenFail === 'AURORA-1010',
      '13b. Falha de escrita na regeneração retorna HTTP 500 e preserva o código anterior (AURORA-1010)'
    );

    // Successful regeneration by Síndico A for own Condo A -> new code, revokes token3, old code rejected
    const regenOkRes = await jsonReq(
      instance1.baseUrl,
      'POST',
      `/api/admin/condominiums/${CONDO_A_ID}/regenerate-portaria-code`,
      {},
      SINDICO_A_TOKEN
    );
    const newCodeA = regenOkRes.data?.portaria_access_code;
    const rowAfterRegen = db.tables.condominium_settings.find((s) => s.condominium_id === CONDO_A_ID);
    const validateToken3AfterRegen = await jsonReq(instance2.baseUrl, 'GET', `/api/portaria/validate-token/${token3}`);
    const activateOldCodeAfterRegen = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: 'AURORA-1010',
    });
    const activateNewCodeAfterRegen = await jsonReq(instance2.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: newCodeA,
    });

    assert(
      regenOkRes.status === 200 &&
        Boolean(newCodeA) &&
        newCodeA !== 'AURORA-1010' &&
        rowAfterRegen?.portaria_access_code === newCodeA &&
        rowAfterRegen?.active_portaria_token === null &&
        validateToken3AfterRegen.status === 401 &&
        activateOldCodeAfterRegen.status === 404 &&
        activateNewCodeAfterRegen.status === 200,
      '13c. Regeneração persiste novo código único, revoga token3 imediatamente (401 em outra instância) e invalida código antigo'
    );

    // -------------------------------------------------------------------------
    // Cenário 17b: Simulação explícita de reinicialização do servidor (instância 3 criada após mutações)
    // -------------------------------------------------------------------------
    const confirmNewSession = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/confirm-link', {
      access_code: newCodeA,
    });
    const token4 = confirmNewSession.data?.portaria_token;
    const instance3 = await startTestServer(createApp({ supabase: mockClient, supabaseAdmin: mockClient, isProduction: true }));
    try {
      const validateToken4ColdStart = await jsonReq(instance3.baseUrl, 'GET', `/api/portaria/validate-token/${token4}`);
      const validateToken3ColdStart = await jsonReq(instance3.baseUrl, 'GET', `/api/portaria/validate-token/${token3}`);
      assert(
        validateToken4ColdStart.status === 200 && validateToken3ColdStart.status === 401,
        '17b. Nova instância após reinicialização valida apenas o token persistido no banco e recusa tokens anteriores'
      );
    } finally {
      await instance3.close();
    }

    // Check audit events were recorded safely even if audit insert fails once
    db.faults.failAuditInsert = true;
    const resDuringAuditFailure = await jsonReq(instance1.baseUrl, 'POST', '/api/portaria/activate', {
      access_code: newCodeA,
    });
    db.resetFaults();
    assert(
      resDuringAuditFailure.status === 200 &&
        db.tables.auditoria_eventos.some((e) => e.tipo_evento === 'CODIGO_PORTARIA_REGERADO') &&
        db.tables.auditoria_eventos.some((e) => e.tipo_evento === 'PORTARIA_BLOQUEIO_REMOTO') &&
        db.tables.auditoria_eventos.some((e) => e.tipo_evento === 'ADMIN_AUTH_RECUSADA'),
      '10-audit. Eventos de auditoria completos gravados e falha eventual de auditoria não derruba fluxo principal'
    );

    // -------------------------------------------------------------------------
    // Cenário 16: Frontend apiClient.ts (armazenamento unificado, logout, detecção de 401)
    // -------------------------------------------------------------------------
    const createMemoryStorage = () => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => {
          map.set(k, String(v));
        },
        removeItem: (k: string) => {
          map.delete(k);
        },
        clear: () => map.clear(),
      };
    };

    const memLocal = createMemoryStorage();
    const memSession = createMemoryStorage();
    const dispatchedEvents: string[] = [];

    (globalThis as any).localStorage = memLocal;
    (globalThis as any).sessionStorage = memSession;
    if (typeof (globalThis as any).CustomEvent === 'undefined') {
      (globalThis as any).CustomEvent = class CustomEvent {
        type: string;
        detail: any;
        constructor(type: string, init?: { detail?: any }) {
          this.type = type;
          this.detail = init?.detail;
        }
      };
    }
    (globalThis as any).window = {
      location: { origin: instance1.baseUrl },
      dispatchEvent: (ev: any) => {
        dispatchedEvents.push(ev?.type || '');
        return true;
      },
    };

    const apiClient = await import('../lib/apiClient');

    // Legacy keys present should be wiped on clearStoredPortariaToken
    memLocal.setItem('portaria_token', 'old-key-1');
    memSession.setItem('portaria_session', 'old-key-2');

    apiClient.setStoredPortariaToken('tok-perm', true);
    assert(
      memLocal.getItem(apiClient.PORTARIA_TOKEN_STORAGE_KEY) === 'tok-perm' &&
        memSession.getItem(apiClient.PORTARIA_TOKEN_STORAGE_KEY) === null &&
        apiClient.getStoredPortariaToken() === 'tok-perm',
      '16a. setStoredPortariaToken(token, true) grava em localStorage["encomendas_portaria_token"]'
    );

    apiClient.setStoredPortariaToken('tok-temp', false);
    assert(
      memSession.getItem(apiClient.PORTARIA_TOKEN_STORAGE_KEY) === 'tok-temp' &&
        memLocal.getItem(apiClient.PORTARIA_TOKEN_STORAGE_KEY) === null &&
        apiClient.getStoredPortariaToken() === 'tok-temp',
      '16b. setStoredPortariaToken(token, false) grava em sessionStorage["encomendas_portaria_token"]'
    );

    const tokenFromClient = await apiClient.getValidAuthToken();
    assert(
      tokenFromClient === 'tok-temp',
      '16c. getValidAuthToken() lê corretamente encomendas_portaria_token'
    );

    apiClient.clearStoredPortariaToken();
    const tokenAfterLogout = await apiClient.getValidAuthToken();
    assert(
      tokenAfterLogout === null &&
        memLocal.getItem('portaria_token') === null &&
        memSession.getItem('portaria_session') === null,
      '16d. clearStoredPortariaToken() limpa tokens atuais e legados e getValidAuthToken() NÃO retorna MOCK_TOKEN'
    );

    // Calling validate-token with revoked token via apiFetch should auto-clear stored token & emit event
    apiClient.setStoredPortariaToken(token3, true);
    const invalidatedRes = await apiClient.apiFetch(`/api/portaria/validate-token/${token3}`, { skipAuth: true, retries: 0 });
    assert(
      !invalidatedRes.ok &&
        invalidatedRes.status === 401 &&
        apiClient.getStoredPortariaToken() === null &&
        dispatchedEvents.includes('portaria-session-invalidated'),
      '16e. apiFetch diante de 401 PORTARIA_DEACTIVATED limpa token armazenado e dispara evento portaria-session-invalidated'
    );

    // Static verification of frontend files to ensure no unauthorized MOCK_TOKEN fallbacks remain
    const appCode = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
    const condoListCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/CondominiumList.tsx'), 'utf-8');
    const dashboardCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Dashboard.tsx'), 'utf-8');
    const userMgmtCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/UserManagement.tsx'), 'utf-8');
    const userModalCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/UserFormModal.tsx'), 'utf-8');
    const changePwdCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/ChangePassword.tsx'), 'utf-8');

    assert(
      !condoListCode.includes("'MOCK_TOKEN'") &&
        !dashboardCode.includes("'MOCK_TOKEN'") &&
        !userMgmtCode.includes("'MOCK_TOKEN'") &&
        !userModalCode.includes("'MOCK_TOKEN'") &&
        !changePwdCode.includes("'MOCK_TOKEN'") &&
        appCode.includes('clearStoredPortariaToken') &&
        appCode.includes('portaria-session-invalidated'),
      '16f. Frontend livre de fallbacks silenciosos para MOCK_TOKEN e sincronizado com invalidação/logout em App.tsx'
    );
  } finally {
    await instance1.close();
    await instance2.close();
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`TOTAL APROVADOS: ${passed}/${total}`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal na suíte de homologação:', err);
  process.exit(1);
});
