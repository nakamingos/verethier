import { TestBed } from '@angular/core/testing';
import { PortalDraftsService } from './portal-drafts.service';
import { PortalSessionService } from './portal-session.service';

describe('Account-scoped unsaved portal drafts',()=>{
  it('retains drafts only for the current signed-in account',()=>{
    const drafts=new PortalDraftsService().forUser('alice');
    drafts.newRules.set('server',{draft:{min_items:5},mode:'numbers',review:false});
    drafts.edits.set('server:edit:174',{editor:{id:174,version:'old-version'},inputs:{min_items:'5'},traits:null,roles:[],review:true});
    expect(drafts.forUser('alice').newRules.get('server')?.draft.min_items).toBe(5);
    expect(drafts.forUser('bob').newRules.size).toBe(0);
    expect(drafts.edits.size).toBe(0);
  });
  it('clears both new and edited drafts on sign-out/session invalidation',()=>{
    const drafts=TestBed.inject(PortalDraftsService).forUser('alice');
    drafts.newRules.set('server',{draft:{min_items:5},mode:'numbers',review:false});
    drafts.visible.set('server','new');
    TestBed.inject(PortalSessionService).clear();
    expect(drafts.newRules.size).toBe(0);expect(drafts.visible.size).toBe(0);
  });
});
