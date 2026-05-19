const https = require('https');
const url = 'https://letsfg.co/api/results/ws_863652fb4a724ec3?probe=1';

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            const offers = json.offers || [];
            console.log(`Total offers: ${offers.length}`);
            if (offers.length > 0) {
                console.log('Keys in first offer:', Object.keys(offers[0]).join(', '));
                // Inspect potential price fields
                const check = offers.slice(0, 10).map(o => ({
                    total: o.total_amount || o.total || o.price?.total || o.amount,
                    id: o.id || o.offer_id
                }));
                console.log('Sample prices/ids:', JSON.stringify(check));
            }
            
            // Search by times/route if price fields are unclear
            const m1 = offers.find(o => JSON.stringify(o).includes("10:50") && JSON.stringify(o).includes("17:45"));
            const m2 = offers.find(o => JSON.stringify(o).includes("07:05") && JSON.stringify(o).includes("15:25"));
            
            if (m1) console.log('MATCH_TIME_1:', JSON.stringify(m1));
            if (m2) console.log('MATCH_TIME_2:', JSON.stringify(m2));

        } catch (e) { console.error(e.message); }
    });
});
