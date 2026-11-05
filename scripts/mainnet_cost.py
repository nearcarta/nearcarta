P={'NEAR':4.74,'ETH':2358.56,'ZEC':1311.95,'USDC':0.999532}
B=1e-5  # NEAR per byte
TG=1e-4 # NEAR per Tgas (floor)
ACC=0.007
rows=[]
def r(id,piece,what,near=0,eth=0,zec=0,usdc=0,kind='burn',opt='required',src=''):
    rows.append(dict(id=id,piece=piece,what=what,near=near,eth=eth,zec=zec,usdc=usdc,kind=kind,opt=opt,src=src))
# --- NEAR side, recommended path (global code for charters because the public factory needs it)
r(1,'Root account','named `<root>.near` via registrar: creation charge + gas',ACC+0.001,kind='burn',src='G,A')
r(2,'Charters (global code)','publish main `oath` (R16.1 propose_batch + C5, reproducible build-3709807) 401,313 B as global contract by hash, as on the earlier network R17 factory `nccharters-53836`: 10 NEAR/100 KB, burned',401313*1e-4,kind='burn',src='GC')
r(3,'Charters (global code)','gas to upload 401 KB (0.58+0.13*X Tgas)',(0.58+0.13*401)*TG,src='G')
r(4,'Factory','`charter_factory` account: creation + 201,539 B storage (measured)',ACC+201539*B,kind='lock',src='S,M')
r(5,'Factory','deploy gas 175 KB + init + delete full-access key',(0.58+0.13*175+10+0.41)*TG,src='G')
r(6,'Charters x4','Guardhouse/Mist Bank, House, Town Hall, shared Vault/Arena charter: each 833 B (measured, >770 so all bytes) + 0.01 registry fee',4*(833*B+0.01),kind='lock',src='S,M')
r(7,'Charters x4','creation charge + create/init gas (~30 Tgas each)',4*(ACC+30*TG),src='G')
r(8,'Charters x4','set clause + add agent FC key + delete FAK (3 calls x ~10 Tgas each)',4*3*10*TG,src='G')
r(9,'Shops / merchants','6 plain receiver accounts (cafe, books, bakery, ...): creation only, <770 B',6*(ACC+0.0005),src='A')
r(10,'Guardhouse','DAO role = plain account (earlier network one is 182 B): creation only',ACC+0.0005,src='A,M')
r(11,'Guardhouse','demo txs: paid, denied, escalated (yield/resume), approve, freeze: 6 calls x <=60 Tgas',6*60*TG,src='G')
r(12,'Guardhouse','smallest payout amounts: cap 0.0001 NEAR, 2 paid moves (go to own accounts, recoverable)',0.0002,kind='move',src='-')
r(13,'Town Hall DAO','Sputnik v2 DAO: 546,780 B storage (measured) + creation',ACC+546780*B,kind='lock',src='S,M')
r(14,'Town Hall DAO','proposal bond (refunded) + 3 proposal/vote calls',0.1+3*20*TG,kind='lock',src='M')
r(15,'Arena','`arena` contract: 340,244 B storage (measured, incl. 32 attempts) + creation',ACC+340244*B,kind='lock',src='S,M')
r(16,'Arena','deploy gas 329 KB + init + 32 commits + 13 reveals (~10 Tgas each)',(0.58+0.13*329+45*10)*TG,src='G')
r(17,'Vault','shared charter is row 6; runner `propose` calls x 20 at ~25 Tgas',20*25*TG,src='G')
r(18,'House deed (NEP-171)','`house_nft` 209,633 B storage (measured) + creation + 1 mint',ACC+209633*B+0.01,kind='lock',opt='optional',src='S,M')
r(19,'Toll (Base)','`toll` v3 instance: 190,195 B storage (measured toll-usdc) + creation; native ETH and USDC rules in one instance',ACC+190195*B,kind='lock',src='S,M')
r(20,'Toll (Base)','MPC `sign` (1 yocto) + `verify_foreign_transaction` (1 yocto): 2 x (50+30) Tgas attached, upper bound',2*80*TG,src='MPC,G')
r(21,'Toll (Arbitrum)','second `toll` instance: 186,207 B (measured toll-arb) + creation + 1 sign',ACC+186207*B+80*TG,kind='lock',opt='optional',src='S,M,MPC')
r(22,'Chronicle','read-only from RPC/indexer: no on-chain cost',0,src='-')
r(23,'NEAR AI agent stake','50 NEAR mainnet stake for a NEAR AI hosted agent: NOT needed (API key use only)',0,opt='optional (skip)',src='-')
# EVM
r(30,'Toll (Base)','fund derived address: 1 native tx 21k gas + 1 USDC tx 65k gas at 0.01 gwei, x3 headroom + 1e12 wei test value',eth=3*(86000*0.01e-9)+1e-6,usdc=0.01,kind='spend',src='BASE')
r(31,'Toll (Arbitrum)','1 native tx 21k gas at 0.04 gwei, x3 headroom + 1e12 wei test value',eth=3*21000*0.04e-9+1e-6,kind='spend',opt='optional',src='ARB')
r(32,'Ferry / 1Click leg A','Base USDC -> ZEC: minimum 1.750123 USDC, use 2.50 USDC; Base deposit tx 65k gas',eth=65000*0.01e-9*3,usdc=2.50,kind='move',src='1C,BASE')
r(33,'Ferry / 1Click legs A+B','expected round-trip loss (withdraw fees 32,000 zats + 0.0024 USDC, spread); rest returns as USDC',usdc=0.57,kind='burn',src='1C')
# Zcash
r(40,'Mist Bank Zcash','2 shielded sends (in, out) at ZIP-317 10,000 zats each + leg B send to 1Click',zec=3*10000e-8,kind='burn',src='Z')
r(41,'Mist Bank Zcash','working notes come from leg A output (>=132,000 zats needed for leg B); no extra ZEC buy',zec=0,kind='move',src='1C')
# NEAR AI
tin,tout=1_000_000,200_000
r(50,'NEAR AI (glm-5.3-flash)','~500 calls x 2,000 in / 400 out = 1M in, 0.2M out at $0.08/$0.50 per 1M',usdc=tin/1e6*0.08+tout/1e6*0.50,kind='burn',src='AI')
import json;json.dump(rows,open(__import__('os').devnull,'w'),indent=1)
def tot(f):
    s={'NEAR':0,'ETH':0,'ZEC':0,'USDC':0}
    for x in rows:
        if f(x):
            s['NEAR']+=x['near'];s['ETH']+=x['eth'];s['ZEC']+=x['zec'];s['USDC']+=x['usdc']
    s['USD']=s['NEAR']*P['NEAR']+s['ETH']*P['ETH']+s['ZEC']*P['ZEC']+s['USDC']*P['USDC'];return s
req=tot(lambda x:x['opt']=='required');allr=tot(lambda x:True);opt=tot(lambda x:x['opt']!='required')
burn=tot(lambda x:x['opt']=='required' and x['kind'] in('burn','spend'))
print('req',req);print('opt',opt);print('all',allr);print('req nonlock',tot(lambda x:x['opt']=='required' and x['kind']!='lock'))
# Path A: no global, factory skipped, 4 charters regular deploys of the 401,313-B oath (estimate 405,731 B per account: +4,418 B state as measured on r16oath)
A=4*(ACC+405731*B+(0.58+0.13*401)*TG)
print('pathA charters',A,'vs global path',rows[1]['near']+rows[2]['near']+rows[3]['near']+rows[4]['near']+rows[5]['near']+rows[6]['near'])
SRC={'S':'https://docs.near.org/protocol/storage/storage-staking (1e19 yocto/byte = 1 NEAR per 100 KB)',
'A':'https://docs.near.org/integrations/accounts (0.007 NEAR creation charge; >770 B accounts reserve all bytes)',
'G':'https://docs.near.org/protocol/transactions/gas (floor 1 Tgas = 0.0001 NEAR; deploy 0.58+0.13X Tgas; FAK/DeleteKey 0.41-0.42 Tgas)',
'GC':'https://docs.near.org/smart-contracts/global-contracts (10 NEAR per 100 KB, burned; worth it at ~10+ accounts)',
'MPC':'https://github.com/near/mpc/blob/main/crates/contract/README.md (`sign` and `verify_foreign_transaction` need 1 yoctoNEAR; mainnet contract `v1.signer` per https://docs.near.org/chain-abstraction/chain-signatures/implementation)',
'BASE':'https://base.blockscout.com/api/v2/stats (gas avg 0.01 gwei, fetched 2026-10-29 02:00 Cairo)',
'ARB':'https://arbitrum.blockscout.com/api/v2/stats (gas avg 0.04 gwei, fetched 2026-10-29 02:00 Cairo)',
'1C':'1Click API dry quotes 2026-10-28 (https://1click.chaindefuser.com/v0/quote, dry:true): leg A error "try at least 1750123" (1.750123 USDC); leg B min 132,000 zats; withdraw fee 32,000 zats / 0.0024 USDC',
'Z':'https://zips.z.cash/zip-0317 (marginal fee 5,000 zats x 2 grace actions = 10,000 zats minimum)',
'AI':'https://cloud-api.near.ai/v1/model/list (z-ai/glm-5.3-flash: input 80e-9, output 500e-9 USD per token)',
'M':'measured earlier network `storage_bytes` via https://test.api.fastnear.com/v1/account/<id>/full on 2026-10-29; mainnet uses the same wasm and the same price',
'PX':'https://api.coingecko.com/api/v3/simple/price?ids=near,ethereum,zcash,usd-coin&vs_currencies=usd (2026-10-29)'}
def f(v,n=6):
    return '' if not v else ('%.*f'%(n,v)).rstrip('0').rstrip('.')
L=[]
L.append('# Mainnet cost plan: the absolute minimum to move every piece\n')
L.append('Status: plan only. Nothing here has been spent or signed on mainnet. Each piece moves only after it is verified working on earlier network (see `judges/VERIFY.md`). Prices are from today, 2026-10-29: NEAR $%.2f, ETH $%.2f, ZEC $%.2f, USDC $%.6f [PX].\n'%(P['NEAR'],P['ETH'],P['ZEC'],P['USDC']))
L.append('Rules used: storage is locked, not spent (it comes back when state or the account is deleted). Gas, the account creation charge, global contract publishing, fees and swap spread are burned. Gas is priced at the protocol floor (1 Tgas = 0.0001 NEAR) and attached gas is an upper bound; unused gas is refunded.\n')
L.append('Kind: **burn** = gone; **lock** = storage stake, recoverable; **move** = working capital that returns to our own accounts; **spend** = paid to another chain as gas.\n')
L.append('## Items\n')
L.append('| # | Piece | What | NEAR | ETH | ZEC | USDC/USD | Kind | Required? | Source |')
L.append('|---|---|---|---|---|---|---|---|---|---|')
for x in rows:
    L.append('| %d | %s | %s | %s | %s | %s | %s | %s | %s | %s |'%(x['id'],x['piece'],x['what'],f(x['near'],5),f(x['eth'],8),f(x['zec'],8),f(x['usdc'],4),x['kind'],x['opt'],x['src']))
def line(name,s): return '| %s | %s | %s | %s | %s | **$%.2f** |'%(name,f(s['NEAR'],4),f(s['ETH'],8) or '0',f(s['ZEC'],8) or '0',f(s['USDC'],4) or '0',s['USD'])
L.append('\n## Totals\n')
L.append('| Set | NEAR | ETH | ZEC | USDC | USD |')
L.append('|---|---|---|---|---|---|')
T=[('Required, all kinds (cash to hold)',lambda x:x['opt']=='required'),
   ('Required, burned or spent only',lambda x:x['opt']=='required' and x['kind'] in('burn','spend')),
   ('Required, locked (recoverable)',lambda x:x['opt']=='required' and x['kind']=='lock'),
   ('Optional items',lambda x:x['opt']!='required'),
   ('Everything incl. optional',lambda x:True)]
for n,fn in T: L.append(line(n,tot(fn)))
fl=tot(lambda x:x['opt']=='required' and x['id'] not in (2,3,4,5,6,7)); fl['NEAR']+=A; fl['USD']+=A*P['NEAR']
L.append(line('Floor: required, factory deferred, 4 charters deployed as regular contracts (path 2 below)',fl))
L.append('\nThe biggest single item is row 2, publishing the charter code as a global contract (%.2f NEAR, about $%.0f, burned). It is needed only because the public factory lets anyone create a charter with no code of their own.\n'%(rows[1]['near'],rows[1]['near']*P['NEAR']))
L.append('## Cheapest path\n')
L.append('1. **Shrunk wasm.** The earlier network R17 factory publishes the reproducible 401,313 B build unchanged (40.13 NEAR of earlier network burn). On R16 a `wasm-opt -Oz` pass cut 10.1%% (367,202 to 330,006 B); on this build that would save about %.2f NEAR of burn. Each 10 KB cut saves 1 NEAR. Rebuild it reproducibly and re-verify on earlier network first.'%(401313*(1-330006/367202)*1e-4))
L.append('2. **Global code only for the factory.** If the public factory waits, deploy the 4 house charters as regular contracts instead: 4 x ~405,731 B = %.2f NEAR, all locked and recoverable, against %.2f NEAR for the global path (mostly burned). The global path pays off at 10 or more charters [GC].'%(A,rows[1]['near']+rows[2]['near']+rows[3]['near']+rows[4]['near']+rows[5]['near']+rows[6]['near']))
L.append('3. **Charters through the factory.** Each one is 833 B (it holds a reference to the code, not the code), so initialise the mainnet factory with `min_deposit` 0.02 NEAR, not the earlier network 0.3 NEAR (the contract only requires more than the 0.01 registry fee).')
L.append('4. **One Toll instance for Base** covers both native ETH and USDC rules. Arbitrum is a second instance and is optional.')
L.append('5. **DAO.** Guardhouse uses a plain account as its DAO role (182 B on earlier network). Only Town Hall needs the Sputnik DAO, and Guardhouse can point at the same one.')
L.append('6. **Smallest amounts.** Use a 0.0001 NEAR cap, a 1e12 wei EVM test value and 0.01 USDC. Leg A needs 1.750123 USDC at minimum and leg B 132,000 zats, so ZEC comes from leg A and none is bought.')
L.append('7. **No full-access keys** after deploy (as on earlier network). Deleting each key costs 0.41 Tgas (0.000041 NEAR).')
L.append('8. **Skip:** the NEAR AI 50 NEAR agent stake (API-key inference is enough), `mock_ft` (mainnet uses real USDC), Chronicle (read-only, free), and Vercel/Render (free plans).\n')
L.append('## Order (each step only after its earlier network check passes)\n')
L.append('1. Root account and factory, with the global code published (rows 1-5). 2. Charters (6-8). 3. Shops and Guardhouse (9-12). 4. Town Hall DAO (13-14). 5. Arena and Vault (15-17). 6. Toll Base (19-20, 30). 7. Ferry, 1Click and Mist Bank, using the phase-2 scripts with `--live` only after the owner approves (32-33, 40-41). 8. Optional: House deed, Toll Arbitrum (18, 21, 31).\n')
L.append('## Sources\n')
for k,v in SRC.items(): L.append('- [%s] %s'%(k,v))
L.append('\nThe calculator that produced this table is `scripts/mainnet_cost.py`; rerun it with new prices.')
open(__import__('os').path.join(__import__('os').path.dirname(__file__),'..','docs','MAINNET_COST_PLAN.md'),'w').write('\n'.join(L)+'\n')
