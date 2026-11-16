import http from 'http';
import crypto from 'crypto';
import { api } from '../lib/apiClient';

process.env.VERCEL = '1';

/**
 * Automated Test Suite for Condominium Management Module
 * Verifies API communication, JSON responses, strict JWT auth enforcement,
 * error handling, and CRUD data flow using real Express routes from server.ts.
 */

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

type Row = Record<string, any>;

class CondoTestMockSupabase {
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
        admin: {
          listUsers: async () => ({
            data: { users: Array.from(db.authTokens.values()) },
            error: null,
          }),
        },
      },
    };
  }
}

export async function runCondominiumTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING CONDOMINIUM MANAGEMENT AUTOMATED TESTS');
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

  const ADMIN_ID = 'aaaa1111-1111-4111-8111-111111111111';
  const ADMIN_JWT = 'condo-test-admin-jwt';
  const INITIAL_CONDO_ID = '11111111-1111-4111-8111-111111111111';

  const db = new CondoTestMockSupabase();
  db.authTokens.set(ADMIN_JWT, { id: ADMIN_ID, email: 'admin@condotests.com' });
  db.tables.profiles.push({
    id: ADMIN_ID,
    full_name: 'Admin Homologação',
    role: 'admin',
    condominium_id: INITIAL_CONDO_ID,
    active: true,
  });
  db.tables.condominiums.push({
    id: INITIAL_CONDO_ID,
    name: 'Condomínio Base Teste',
    address: 'Rua Base, 100',
    active: true,
  });

  const mockClient = db.createClient();
  const app = createApp({ supabase: mockClient, supabaseAdmin: mockClient, isProduction: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authOpts = { headers: { Authorization: `Bearer ${ADMIN_JWT}` }, retries: 0 };

  try {
    // Test 0: Verify unauthenticated request is rejected with 401
    const unauthRes = await api.get(`${baseUrl}/api/admin/condominiums`, { skipAuth: true, retries: 0 });
    assert(
      !unauthRes.ok && unauthRes.status === 401,
      'Admin Auth Enforcement (401 without JWT)',
      `Expected HTTP 401 without Authorization header, got ${unauthRes.status}`,
      unauthRes
    );

    // Test 1: Validate Catch-All API 404 Returns JSON (Not HTML/Doctype)
    const res404 = await api.get(`${baseUrl}/api/invalid-route-test-404`, { skipAuth: true, retries: 0 });
    assert(
      !res404.ok && res404.status === 404 && res404.data?.error !== undefined && typeof res404.data === 'object',
      'API Catch-All 404 JSON Validation',
      'Non-existent route should return 404 JSON, not HTML',
      res404
    );

    // Test 2: Fetch Condominiums List
    const listRes = await api.get(`${baseUrl}/api/admin/condominiums`, authOpts);
    assert(
      listRes.ok && Array.isArray(listRes.data?.condominiums),
      'Condominiums List Endpoint (/api/admin/condominiums)',
      `Failed to load condominiums list JSON (status ${listRes.status})`,
      listRes
    );

    // Test 3: Fetch Condominiums with trailing slash
    const slashRes = await api.get(`${baseUrl}/api/admin/condominiums/`, authOpts);
    assert(
      slashRes.ok && Array.isArray(slashRes.data?.condominiums),
      'Condominiums Trailing Slash Normalization (/api/admin/condominiums/)',
      `Failed on trailing slash endpoint (status ${slashRes.status})`,
      slashRes
    );

    // Test 4: Create Condominium Validation
    const testCondoName = `Test Condo Automated ${Date.now()}`;
    const createRes = await api.post(
      `${baseUrl}/api/condominiums/create`,
      {
        name: testCondoName,
        address: 'Rua de Teste Automatizado 123',
      },
      authOpts
    );

    const createdId = createRes.data?.condominium?.id || createRes.data?.condo?.id;
    assert(
      createRes.ok && Boolean(createdId),
      'Create Condominium Endpoint (/api/condominiums/create)',
      `Failed to create new condominium (status ${createRes.status}, error: ${createRes.error || 'unknown'})`,
      createRes
    );

    if (createdId) {
      // Test 5: Update Condominium
      const updateRes = await api.put(
        `${baseUrl}/api/admin/condominiums/${createdId}`,
        {
          name: testCondoName + ' (Updated)',
          address: 'Rua Atualizada 456',
        },
        authOpts
      );
      assert(
        updateRes.ok && updateRes.data?.condominium?.name?.includes('Updated'),
        'Update Condominium Endpoint (/api/admin/condominiums/:id)',
        `Failed to update condominium (status ${updateRes.status}, error: ${updateRes.error || 'unknown'})`,
        updateRes
      );

      // Test 6: Toggle Status
      const statusRes = await api.patch(
        `${baseUrl}/api/admin/condominiums/${createdId}/status`,
        { active: false },
        authOpts
      );
      assert(
        statusRes.ok && statusRes.data?.condominium?.active === false,
        'Toggle Condominium Status Endpoint (/api/admin/condominiums/:id/status)',
        `Failed to toggle active status (status ${statusRes.status})`,
        statusRes
      );

      // Test 7: Fetch Condo Users
      const usersRes = await api.get(`${baseUrl}/api/admin/condominiums/${createdId}/users`, authOpts);
      assert(
        usersRes.ok && Array.isArray(usersRes.data?.profiles),
        'Fetch Condo Users Endpoint (/api/admin/condominiums/:id/users)',
        `Failed to fetch condo users (status ${usersRes.status})`,
        usersRes
      );

      // Test 8: Delete Condominium
      const deleteRes = await api.delete(`${baseUrl}/api/admin/condominiums/${createdId}?force=true`, authOpts);
      assert(
        deleteRes.ok,
        'Delete Condominium Endpoint (/api/admin/condominiums/:id)',
        `Failed to delete test condominium (status ${deleteRes.status})`,
        deleteRes
      );
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('------------------------------------------------------');
  console.log('📊 TEST RESULTS SUMMARY:');
  console.log('------------------------------------------------------');
  let passedCount = 0;
  results.forEach((r, idx) => {
    if (r.passed) {
      passedCount++;
      console.log(`✅ [${idx + 1}/${results.length}] ${r.name}`);
    } else {
      console.error(`❌ [${idx + 1}/${results.length}] ${r.name}`);
      console.error(`   Details: ${r.message}`);
    }
  });

  console.log('------------------------------------------------------');
  console.log(`TOTAL PASSED: ${passedCount}/${results.length}`);
  console.log('======================================================\n');

  return {
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    results,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCondominiumTests()
    .then((res) => {
      if (res.failed > 0) process.exit(1);
      else process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error running tests:', err);
      process.exit(1);
    });
}
