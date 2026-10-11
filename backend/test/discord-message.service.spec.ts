import { Test, TestingModule } from '@nestjs/testing';
import { DiscordMessageService } from '../src/services/discord-message.service';
import { Logger } from '@nestjs/common';
import { ButtonStyle } from 'discord.js';

// Mock Logger methods to suppress error output during tests
const loggerSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});
const loggerDebugSpy = jest.spyOn(Logger, 'debug').mockImplementation(() => {});

const mockClient = {
  user: { id: 'bot-user-id' }
};

const mockChannel = {
  id: 'channel-id',
  name: 'test-channel',
  messages: {
    fetch: jest.fn(),
    fetchPinned: jest.fn(),
  },
  send: jest.fn(),
};

const mockMessage = {
  id: 'message-id',
  author: { id: 'bot-user-id' },
  embeds: [
    {
      title: 'Wallet Verification',
      description: 'Test description'
    }
  ],
  components: [
    {
      type: 1, // ActionRowBuilder type
      components: [
        {
          type: 2, // ButtonComponent type
          customId: 'requestVerification',
          label: 'Verify Now',
          style: ButtonStyle.Primary
        }
      ]
    }
  ]
};

const mockMessagesCollection = new Map([
  ['message-id', mockMessage]
]);

describe('DiscordMessageService', () => {
  let service: DiscordMessageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiscordMessageService],
    }).compile();

    service = module.get<DiscordMessageService>(DiscordMessageService);
    service.initialize(mockClient as any);
    jest.clearAllMocks();
    mockChannel.messages.fetchPinned.mockResolvedValue(new Map());
    loggerSpy.mockClear();
    loggerDebugSpy.mockClear();
  });

  afterAll(() => {
    loggerSpy.mockRestore();
    loggerDebugSpy.mockRestore();
  });

  describe('findExistingVerificationMessage', () => {
    it('should find existing verification message (any bot message with buttons)', async () => {
      mockChannel.messages.fetch.mockResolvedValue(mockMessagesCollection);

      const result = await service.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(true);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    });

    it('should return false when no verification message found', async () => {
      const emptyMessages = new Map();
      mockChannel.messages.fetch.mockResolvedValue(emptyMessages);

      const result = await service.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(false);
    });

    it('should return false when client not initialized', async () => {
      const uninitializedService = new DiscordMessageService();

      const result = await uninitializedService.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(false);
    });

    it('should return false when bot user ID not available', async () => {
      const clientWithoutUserId = { user: null };
      const serviceWithoutUserId = new DiscordMessageService();
      serviceWithoutUserId.initialize(clientWithoutUserId as any);

      const result = await serviceWithoutUserId.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(false);
    });

    it('should handle messages from other bots', async () => {
      const otherBotMessage = {
        ...mockMessage,
        author: { id: 'other-bot-id' }
      };
      const messagesWithOtherBot = new Map([
        ['other-message-id', otherBotMessage]
      ]);
      mockChannel.messages.fetch.mockResolvedValue(messagesWithOtherBot);

      const result = await service.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(false);
    });

    it('should return null for bot messages without buttons', async () => {
      const messageWithoutButtons = {
        ...mockMessage,
        components: []
      };
      const messagesWithoutButtons = new Map([
        ['no-button-message', messageWithoutButtons]
      ]);
      mockChannel.messages.fetch.mockResolvedValue(messagesWithoutButtons);

      const result = await service.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(false);
    });

    it('should find bot message with verification button (any style)', async () => {
      const verificationMessage = {
        id: 'verification-message-id',
        author: { id: 'bot-user-id' },
        embeds: [{ title: 'Different Title' }], // Different embed title but has button
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                customId: 'requestVerification',
                label: 'Verify Now',
                style: ButtonStyle.Secondary
              }
            ]
          }
        ]
      };
      const messagesWithVerification = new Map([
        ['verification-message-id', verificationMessage]
      ]);
      mockChannel.messages.fetch.mockResolvedValue(messagesWithVerification);

      const result = await service.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(true);
    });

    it('should handle fetch errors gracefully', async () => {
      mockChannel.messages.fetch.mockRejectedValue(new Error('Fetch failed'));

      const result = await service.findExistingVerificationMessage(mockChannel as any);

      expect(result).toBe(false);
    });
  });

  describe('createVerificationMessage', () => {
    it('should create verification message successfully', async () => {
      const sentMessage = { id: 'new-message-id' };
      mockChannel.send.mockResolvedValue(sentMessage);

      const result = await service.createVerificationMessage(mockChannel as any);

      expect(result).toBe('new-message-id');
      expect(mockChannel.send).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: 'Bouncer · Wallet Verification'
            })
          })
        ]),
        components: expect.arrayContaining([
          expect.objectContaining({
            components: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  label: 'Request Verification',
                  custom_id: 'requestVerification'
                })
              })
            ])
          })
        ])
      });
    });

    it('should handle send errors', async () => {
      mockChannel.send.mockRejectedValue(new Error('Send failed'));

      await expect(service.createVerificationMessage(mockChannel as any)).rejects.toThrow('Send failed');
    });
  });
});
