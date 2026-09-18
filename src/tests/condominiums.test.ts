import { api } from '../lib/apiClient';

/**
 * Automated Test Suite for Condominium Management Module
 * Verifies API communication, JSON responses, error handling, and robust data flow.
 */

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, failureMsg: string, details?: any) {
  if (condition) {
    results.push({ name: testName, passed: true, message: 'PASS: ' + testName });
  } else {
    results.push({ name: testName, passed: false, message: 'FAIL: ' + failureMsg, details });
  }
}

export async function runCondominiumTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING CONDOMINIUM MANAGEMENT AUTOMATED TESTS');
  console.log('======================================================\n');

  // Test 1: Validate Catch-All API 404 Returns JSON (Not HTML/Doctype)
  try {
    const res = await api.get('/api/invalid-route-test-404');
    assert(
      !res.ok && res.data?.error !== undefined && typeof res.data === 'object',
      'API Catch-All 404 JSON Validation',
      'Non-existent route should return 404 JSON, not HTML',
      res
    );
  } catch (err: any) {
    assert(false, 'API Catch-All 404 JSON Validation', 'Threw exception instead of returning JSON result: ' + err.message);
  }

  // Test 2: Fetch Condominiums List
  try {
    const res = await api.get('/api/admin/condominiums');
    assert(
      res.ok && Array.isArray(res.data?.condominiums),
      'Condominiums List Endpoint (/api/admin/condominiums)',
      'Failed to load condominiums list JSON',
      res
    );
  } catch (err: any) {
    assert(false, 'Condominiums List Endpoint (/api/admin/condominiums)', 'Exception during fetch: ' + err.message);
  }

  // Test 3: Fetch Condominiums with trailing slash
  try {
    const res = await api.get('/api/admin/condominiums/');
    assert(
      res.ok && Array.isArray(res.data?.condominiums),
      'Condominiums Trailing Slash Normalization (/api/admin/condominiums/)',
      'Failed on trailing slash endpoint',
      res
    );
  } catch (err: any) {
    assert(false, 'Condominiums Trailing Slash Normalization', 'Exception: ' + err.message);
  }

  // Test 4: Create Condominium Validation
  try {
    const testCondoName = `Test Condo Automated ${Date.now()}`;
    const res = await api.post('/api/condominiums/create', {
      name: testCondoName,
      address: 'Rua de Teste Automatizado 123'
    });

    assert(
      res.ok && (res.data?.condominium?.id || res.data?.condo?.id),
      'Create Condominium Endpoint (/api/condominiums/create)',
      `Failed to create new condominium (status ${res.status}, error: ${res.error || 'unknown'}, data: ${JSON.stringify(res.data)})`,
      res
    );

    const createdId = res.data?.condominium?.id || res.data?.condo?.id;

    if (createdId) {
      // Test 5: Update Condominium
      const updateRes = await api.put(`/api/admin/condominiums/${createdId}`, {
        name: testCondoName + ' (Updated)',
        address: 'Rua Atualizada 456'
      });
      assert(
        updateRes.ok && updateRes.data?.condominium?.name?.includes('Updated'),
        'Update Condominium Endpoint (/api/admin/condominiums/:id)',
        `Failed to update condominium (status ${updateRes.status}, error: ${updateRes.error || 'unknown'}, data: ${JSON.stringify(updateRes.data)})`,
        updateRes
      );

      // Test 6: Toggle Status
      const statusRes = await api.patch(`/api/admin/condominiums/${createdId}/status`, {
        active: false
      });
      assert(
        statusRes.ok && statusRes.data?.condominium?.active === false,
        'Toggle Condominium Status Endpoint (/api/admin/condominiums/:id/status)',
        'Failed to toggle active status',
        statusRes
      );

      // Test 7: Fetch Condo Users
      const usersRes = await api.get(`/api/admin/condominiums/${createdId}/users`);
      assert(
        usersRes.ok && Array.isArray(usersRes.data?.profiles),
        'Fetch Condo Users Endpoint (/api/admin/condominiums/:id/users)',
        'Failed to fetch condo users',
        usersRes
      );

      // Test 8: Delete Condominium
      const deleteRes = await api.delete(`/api/admin/condominiums/${createdId}?force=true`);
      assert(
        deleteRes.ok,
        'Delete Condominium Endpoint (/api/admin/condominiums/:id)',
        'Failed to delete test condominium',
        deleteRes
      );
    }
  } catch (err: any) {
    assert(false, 'Condominium CRUD Lifecycle', 'Exception during CRUD lifecycle test: ' + err.message);
  }

  // Summary Report
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
    results
  };
}

// Execute if run directly via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  runCondominiumTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }).catch((err) => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
  });
}
