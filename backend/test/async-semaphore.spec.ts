import { AsyncSemaphore } from '../src/utils/async-semaphore.util';
const settle=()=>new Promise<void>(done=>setImmediate(done));
describe('Bounded asynchronous work',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('reserves transferred slots, bounds work and releases slots after failures',async()=>{
  const gate=new AsyncSemaphore(3),releases:Array<()=>void>=[];let active=0,max=0;
  const jobs=Array.from({length:8},(_,index)=>gate.run(async()=>{active++;max=Math.max(max,active);await new Promise<void>(done=>releases.push(()=>{active--;done();}));if(index===2)throw new Error('failed');return index;}));
  const results=Promise.allSettled(jobs);await settle();expect(releases).toHaveLength(3);
  for(let i=0;i<8;i++){releases[i]();await settle();}
  expect((await results).filter(r=>r.status==='rejected')).toHaveLength(1);expect(max).toBe(3);
  expect(await gate.run(async()=>9)).toBe(9);
 });
 it('makes release idempotent rather than granting an extra slot',async()=>{
  const gate=new AsyncSemaphore(1),release=await gate.acquire();let count=0;
  const second=gate.acquire().then(release=>{count++;return release;}),third=gate.acquire().then(release=>{count++;return release;});
  release();release();await settle();expect(count).toBe(1);(await second)();(await third)();
 });
 it.each([0,-1,1.5,Infinity])('rejects concurrency %s',limit=>expect(()=>new AsyncSemaphore(limit)).toThrow('Invalid concurrency'));
});
