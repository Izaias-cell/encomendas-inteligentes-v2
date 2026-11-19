import http from 'http';
import crypto from 'crypto';
import { api } from '../lib/apiClient';

process.env.VERCEL = '1';

/**
 * Suite de Testes Automatizados de Persistência e Blindagem da Base de Dados
 * Valida criação, proteção contra duplicidade, integridade referencial, snapshots de backup,
 * autenticação JWT obrigatória e proteção contra alteração indevida via GET ?repair=true.
 */

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

type Row = Record<string, any>;

class IntegrityMockSupabase {
  tables: Record<string, Row[]> = {
    condominiums: [],
    condominium_settings: [],
    profiles: [],
    moradores: [],
    packages: [],
    resident_access_tokens: [],
    whatsapp_conversations: [],
    auditoria_eventos: [],
  };

  authTokens: Map<string, { id: string; email: string }> = new Map();

  createClient() {
    const db = this;

    const makeBuilder = (table: string) => {
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
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
          const totalCount = rows.length;
          if (limitVal !== null) rows = rows.slice(0, limitVal);
          if (selectOptions?.head) return { data: null, error: null, count: totalCount };
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
          const inserted = insertRows.map((raw) => {
            const row = {
              id: raw.id || crypto.randomUUID(),
              created_at: raw.created_at || new Date().toISOString(),
              criado_em: raw.criado_em || new Date().toISOString(),
              ...raw,
            };
            db.tables[table].push(row);
            return { ...row };
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
              updated.push({ ...next });
              return next;
            }
            return row;
          });
          if (!returnRows) return { data: null, error: null };
          if (singleMode === 'single') {
            if (updated.length !== 1) return { data: null, error: { message: `Update single failed in ${table}` } };
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
        select(_cols = '*', opts: any = {}) {
          if (mode !== 'select') returnRows = true;
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
      auth: {
        getUser: async (token: string) => {
          const u = db.authTokens.get(token);
          if (!u) return { data: { user: null }, error: { message: 'Invalid JWT' } };
          return { data: { user: u }, error: null };
        },
      },
    };
  }
}

export async function runPersistenceIntegrityTests() {
  console.log('\n======================================================');
  console.log('🛡️  EXECUTANDO SUÍTE DE TESTES DE PERSISTÊNCIA E BLINDAGEM');
  console.log('======================================================\n');

  const results: TestResult[] = [];
  function assert(condition: boolean, testName: string, failureMsg: string, details?: any) {
    if (condition) {
      results.push({ name: testName, passed: true, message: 'PASS: ' + testName });
    } else {
      results.push({ name: testName, passed: false, message: 'FAIL: ' + failureMsg, details });
    }
  }

  const { createApp } = await import('../../server.ts');

  const ADMIN_ID = 'aaaa2222-2222-4222-8222-222222222222';
  const ADMIN_JWT = 'integrity-test-admin-jwt';
  const BASE_CONDO_ID = '33333333-3333-4333-8333-333333333333';

  const db = new IntegrityMockSupabase();
  db.authTokens.set(ADMIN_JWT, { id: ADMIN_ID, email: 'admin.integrity@test.com' });
  db.tables.profiles.push({
    id: ADMIN_ID,
    full_name: 'Admin Integridade',
    role: 'admin',
    condominium_id: BASE_CONDO_ID,
    active: true,
  });
  db.tables.condominiums.push({
    id: BASE_CONDO_ID,
    name: 'Condomínio Base Integridade',
    address: 'Rua Base, 200',
    active: true,
  });

  const mockClient = db.createClient();
  const app = createApp({ supabase: mockClient, supabaseAdmin: mockClient, isProduction: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authOpts = { headers: { Authorization: `Bearer ${ADMIN_JWT}` }, retries: 0 };

  const uniqueSuffix = Date.now().toString().slice(-6);
  const testCondoName = `Residencial Shielding Test ${uniqueSuffix}`;
  const testCondoAddress = `Avenida da Blindagem, 1000 - Bloco ${uniqueSuffix}`;
  let createdCondoId: string | null = null;

  try {
    // Test 0: Autenticação obrigatória nas rotas administrativas
    const unauthCheck = await api.get(`${baseUrl}/api/admin/integrity-check`, { skipAuth: true, retries: 0 });
    assert(
      !unauthCheck.ok && unauthCheck.status === 401,
      '0. Bloqueio de Acesso Anônimo (HTTP 401 sem JWT)',
      `Esperava status 401 sem Authorization, recebeu ${unauthCheck.status}`,
      unauthCheck
    );

    // Test 1: Verificação de Integridade Inicial
    const res1 = await api.get(`${baseUrl}/api/admin/integrity-check`, authOpts);
    assert(
      res1.ok &&
        (res1.data?.status === 'HEALTHY' || res1.data?.status === 'INCONSISTENCY_DETECTED') &&
        res1.data?.shieldingActive === true,
      '1. Verificação de Integridade e Status de Blindagem',
      `Falha na verificação de integridade inicial (status ${res1.status})`,
      res1
    );

    // Test 2: Cadastro de Condomínio e Validação de Persistência Inicial
    const res2 = await api.post(
      `${baseUrl}/api/condominiums/create`,
      {
        name: testCondoName,
        address: testCondoAddress,
        city_state: 'São Paulo/SP',
        manager_name: 'Síndico Teste Blindagem',
        manager_email: `sindico.shield.${uniqueSuffix}@teste.com`,
        rules: 'Regras de teste de persistência',
        active: true,
      },
      authOpts
    );
    createdCondoId = res2.data?.condominium?.id || res2.data?.condo?.id || null;
    assert(
      res2.ok && Boolean(createdCondoId),
      '2. Cadastro e Persistência Inicial de Condomínio',
      `Falha ao cadastrar condomínio para teste (status ${res2.status}, error: ${res2.error || 'desconhecido'})`,
      res2
    );

    // Test 3: Bloqueio de Cadastros Duplicados
    const res3 = await api.post(
      `${baseUrl}/api/condominiums/create`,
      {
        name: testCondoName,
        address: testCondoAddress,
        city_state: 'São Paulo/SP',
      },
      authOpts
    );
    assert(
      res3.status === 409 &&
        (res3.data?.error?.includes('já se encontra cadastrado') || res3.data?.error?.includes('cadastrado')),
      '3. Proteção Contra Duplicação e Sobrescrita de Registros',
      `O sistema permitiu duplicação de condomínio existente (status ${res3.status}, esperava 409)`,
      res3
    );

    // Test 4: Geração de Snapshot de Backup
    const res4 = await api.post(`${baseUrl}/api/admin/backup-snapshot`, {}, authOpts);
    assert(
      res4.ok && res4.data?.success === true && Boolean(res4.data?.snapshotId),
      '4. Geração Automática de Backup Snapshot',
      `Falha ao gerar snapshot de backup (status ${res4.status})`,
      res4
    );

    // Test 5: Histórico de Backups Disponíveis
    const res5 = await api.get(`${baseUrl}/api/admin/backup-history`, authOpts);
    assert(
      res5.ok && Array.isArray(res5.data?.backups) && res5.data.backups.length > 0,
      '5. Consulta ao Histórico de Snapshots de Backup',
      `Falha ao listar histórico de backups (status ${res5.status})`,
      res5
    );

    // Test 6: Imutabilidade de ID e Validação em Atualizações
    if (createdCondoId) {
      const res6 = await api.put(
        `${baseUrl}/api/admin/condominiums/${createdCondoId}`,
        {
          id: 'id-alterado-proibido',
          name: `${testCondoName} (Atualizado)`,
          address: testCondoAddress,
        },
        authOpts
      );
      assert(
        res6.status === 400 && Boolean(res6.data?.error?.includes('imutável')),
        '6. Bloqueio de Alteração de ID Primário (Imutabilidade)',
        `O sistema permitiu a tentativa de alteração de ID (status ${res6.status})`,
        res6
      );

      // Test 7: Remoção Segura com force=true
      const res7 = await api.delete(`${baseUrl}/api/admin/condominiums/${createdCondoId}?force=true`, authOpts);
      assert(
        res7.ok && res7.data?.success === true,
        '7. Exclusão Controlada com Audit Log',
        `Falha na remoção do condomínio de teste (status ${res7.status})`,
        res7
      );
    }

    // Test 8: Endpoint GET ?repair=true permanece bloqueado (405), POST integrity-repair exige confirm=true, e saúde fica HEALTHY
    const getRepairBlocked = await api.get(`${baseUrl}/api/admin/integrity-check?repair=true`, authOpts);
    const repairPostRes = await api.post(`${baseUrl}/api/admin/integrity-repair`, { confirm: true }, authOpts);
    const finalHealthRes = await api.get(`${baseUrl}/api/admin/integrity-check`, authOpts);
    assert(
      getRepairBlocked.status === 405 &&
        repairPostRes.ok &&
        repairPostRes.data?.success === true &&
        finalHealthRes.ok &&
        finalHealthRes.data?.status === 'HEALTHY',
      '8. Verificação de Saúde e Integridade Pós-Execução (GET somente leitura + POST repair)',
      `Falha na verificação pós-execução (getRepair=${getRepairBlocked.status}, repair=${repairPostRes.status}, health=${finalHealthRes.data?.status})`,
      { getRepairBlocked, repairPostRes, finalHealthRes }
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('------------------------------------------------------');
  console.log('📊 RESUMO DOS TESTES DE PERSISTÊNCIA E BLINDAGEM:');
  console.log('------------------------------------------------------');

  let passedCount = 0;
  results.forEach((r, idx) => {
    if (r.passed) passedCount++;
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} [${idx + 1}/${results.length}] ${r.name}`);
    if (!r.passed) {
      console.log(`   Detalhes: ${r.message}`);
    }
  });

  console.log('------------------------------------------------------');
  console.log(`TOTAL APROVADOS: ${passedCount}/${results.length}`);
  console.log('======================================================\n');

  if (passedCount < results.length) {
    process.exit(1);
  }
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('persistence-integrity')) {
  runPersistenceIntegrityTests();
}
