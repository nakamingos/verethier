import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PortalErrors } from '../src/portal/portal.controller';
import { RuleInputError } from '../src/utils/rule-input-error';
import { parseInscriptionCriteria } from '../src/utils/inscription-rule.util';

function respond(error: unknown) {
  const response = {status:jest.fn().mockReturnThis(),json:jest.fn()};
  new PortalErrors().catch(error,{switchToHttp:()=>({getResponse:()=>response})} as any);
  return {status:response.status.mock.calls[0][0],body:response.json.mock.calls[0][0]};
}
describe('Admin portal actionable errors',()=>{
  it('shows trusted input guidance as a 400 instead of suggesting a provider outage',()=>{
    const result=respond(new RuleInputError('Minimum items must be a positive whole number.'));
    expect(result).toEqual({status:400,body:{message:'Minimum items must be a positive whole number.'}});
  });
  it('preserves the specific malformed-range guidance from the parser',()=>{
    let error:unknown;
    try {parseInscriptionCriteria(null,'10-1');} catch(e) {error=e;}
    expect(respond(error)).toEqual({status:400,body:{message:'Inscription ranges must use safe whole numbers with the start no greater than the end.'}});
  });
  it.each([new Error('database https://example.test/?apikey=private-secret'),new Error('Minimum items must be a positive whole number. private-secret')])('hides untrusted backend errors instead of returning their raw text',error=>{
    const result=respond(error);
    expect(result.status).toBe(503);
    expect(result.body.message).toContain('contact a Bouncer operator');
    expect(JSON.stringify(result.body)).not.toContain('private-secret');
    expect(JSON.stringify(result.body)).not.toContain('Provider checks');
  });
  it('preserves existing structured HTTP errors and access status codes',()=>{
    expect(respond(new BadRequestException('Choose a role.'))).toMatchObject({status:400,body:{message:'Choose a role.'}});
    expect(respond(new ForbiddenException('Forbidden'))).toMatchObject({status:403});
  });
});
