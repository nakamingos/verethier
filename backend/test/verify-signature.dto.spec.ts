import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../src/config/validation.config';
import { VerifySignatureDto } from '../src/dtos/verify-signature.dto';

const pipe = new ValidationPipe(validationPipeOptions());
const meta: ArgumentMetadata = { type: 'body', metatype: VerifySignatureDto };
const validate = (body: unknown) => pipe.transform(body, meta);

// The shape verify.component.ts submits: the server-held context, the chosen
// wallet and proof fields, and the signature.
const evmBody = {
  data: {
    userId: '222222222222222222', discordId: '111111111111111111', nonce: 'a'.repeat(64),
    expiry: 1900000000, address: '0x' + 'a'.repeat(40),
    userTag: 'Member', avatar: 'https://cdn.discordapp.com/avatars/x.png', discordName: 'Guild',
    discordIcon: '', signingOrigin: 'https://bouncer.example', walletType: 'evm', chainId: 8453, proofVersion: 2,
    privacy: { epoch: '11111111-2222-4333-8444-555555555555', share: true, exports: false, notice: '2026-10-27' },
  },
  signature: '0x' + '11'.repeat(65),
};

describe('VerifySignatureDto', () => {
  it('accepts the payload the verify page sends', async () => {
    const result = await validate(evmBody);
    expect(result.data).toMatchObject({ userId: '222222222222222222', chainId: 8453, proofVersion: 2 });
    expect(result.data.privacy).toEqual(evmBody.data.privacy);
  });

  it('accepts a Bitcoin payload without EVM proof fields', async () => {
    const { chainId, proofVersion, ...data } = evmBody.data;
    await expect(validate({ ...evmBody, data: { ...data, walletType: 'bitcoin', address: 'bc1p' + 'q'.repeat(58) } })).resolves.toBeDefined();
  });

  it.each([
    ['a non-snowflake user ID', { userId: '{"$ne": null}' }],
    ['a non-snowflake server ID', { discordId: 'guild' }],
    ['a malformed nonce', { nonce: 'valid-nonce; rm -rf /' }],
    ['a non-numeric expiry', { expiry: '1900000000' }],
    ['an unknown wallet type', { walletType: 'cosmos' }],
    ['a legacy proof version', { proofVersion: 1 }],
    ['an oversized display field', { userTag: 'x'.repeat(257) }],
    ['an empty address', { address: '' }],
    ['an unexpected field', { isAdmin: true }],
  ])('rejects %s', async (_case, change) => {
    await expect(validate({ ...evmBody, data: { ...evmBody.data, ...change } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['userId', 'discordId', 'nonce', 'expiry', 'address'])('requires %s', async field => {
    const data: Record<string, unknown> = { ...evmBody.data };
    delete data[field];
    await expect(validate({ ...evmBody, data })).rejects.toBeInstanceOf(BadRequestException);
  });
});
