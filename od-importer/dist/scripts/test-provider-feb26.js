import { getMysqlPool, getPgPool } from '../src/db.js';
import { runProviderProductionImport } from '../src/provider-production-importer.js';
const parseArgs = () => {
    const args = process.argv.slice(2);
    const map = new Map();
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        if (token.startsWith('--')) {
            map.set(token, args[i + 1] ?? '');
            i += 1;
        }
    }
    return map;
};
const main = async () => {
    const args = parseArgs();
    const providerId = args.get('--provider-id') || '2018001'; // Ritienne default
    const year = Number(args.get('--year') || '2026');
    const month = Number(args.get('--month') || '2');
    const pg = getPgPool();
    const mysql = getMysqlPool();
    const providerRow = await pg.query(`SELECT provider_id, od_prov_num, first_name, last_name
     FROM od_provider_map
     WHERE provider_id = $1
     LIMIT 1`, [providerId]);
    if (!providerRow.rows.length) {
        throw new Error(`Provider id ${providerId} not found in od_provider_map`);
    }
    const provider = providerRow.rows[0];
    const odProvNum = Number(provider.od_prov_num);
    if (!Number.isFinite(odProvNum) || odProvNum <= 0) {
        throw new Error(`Provider ${providerId} (${provider.first_name} ${provider.last_name}) has no valid od_prov_num. ` +
            'Set od_prov_num in od_provider_map before running import.');
    }
    const periodMonth = `${year}-${String(month).padStart(2, '0')}`;
    const result = await runProviderProductionImport(pg, mysql, {
        period_month: periodMonth,
        od_prov_num: odProvNum,
        split_by_clinic: true,
        dry_run: true
    });
    console.log(JSON.stringify({
        provider_id: providerId,
        provider_name: `${provider.first_name ?? ''} ${provider.last_name ?? ''}`.trim(),
        od_prov_num: odProvNum,
        period_month: periodMonth,
        result
    }, null, 2));
};
main().catch((error) => {
    console.error('[test-provider-feb26] FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
