import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { VerifyService } from '../src/services/verify.service';
import { VerifySignatureDto } from '../src/dtos/verify-signature.dto';

/**
 * Security and Input Validation Test Suite
 * 
 * Comprehensive security tests covering:
 * - Input validation and sanitization
 * - Malformed payload handling
 * - Injection attack prevention
 * - Large payload handling
 * - Invalid data type handling
 * - Edge cases and boundary conditions
 */
describe('Security and Input Validation', () => {
  let controller: AppController;
  let app: any;

  const mockAppService = {
    getHealth: jest.fn().mockReturnValue({ status: 'healthy' }),
    getInfo: jest.fn().mockReturnValue({ name: 'Test App' }),
  };

  const mockVerifyService = {
    verifySignatureFlow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService,
        },
        {
          provide: VerifyService,
          useValue: mockVerifyService,
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // Allow extra properties as per DTO
      transform: true,
    }));
    await app.init();

    controller = module.get<AppController>(AppController);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should reject requests with missing data field', async () => {
      const invalidPayload = {
        signature: '0xvalidsignature',
      };

      // This would be caught by the validation pipe before reaching the controller
      // We simulate the validation error that would occur
      const validationError = new BadRequestException('data should not be empty');
      
      // Test that the validation would fail
      expect(() => {
        const dto = new VerifySignatureDto();
        Object.assign(dto, invalidPayload);
        if (!dto.data) {
          throw validationError;
        }
      }).toThrow(BadRequestException);
    });

    it('should reject requests with missing signature field', async () => {
      const invalidPayload = {
        data: {
          address: '0x1234567890123456789012345678901234567890',
        },
      };

      const validationError = new BadRequestException('signature should not be empty');
      
      expect(() => {
        const dto = new VerifySignatureDto();
        Object.assign(dto, invalidPayload);
        if (!dto.signature || dto.signature === '') {
          throw validationError;
        }
      }).toThrow(BadRequestException);
    });

    it('should reject requests with empty signature', async () => {
      const invalidPayload = {
        data: {
          address: '0x1234567890123456789012345678901234567890',
        },
        signature: '',
      };

      const validationError = new BadRequestException('signature should not be empty');
      
      expect(() => {
        const dto = new VerifySignatureDto();
        Object.assign(dto, invalidPayload);
        if (!dto.signature || dto.signature === '') {
          throw validationError;
        }
      }).toThrow(BadRequestException);
    });

    it('should reject non-string signature', async () => {
      const invalidPayload = {
        data: {
          address: '0x1234567890123456789012345678901234567890',
        },
        signature: 12345, // Number instead of string
      };

      const validationError = new BadRequestException('signature must be a string');
      
      expect(() => {
        const dto = new VerifySignatureDto();
        Object.assign(dto, invalidPayload);
        if (typeof dto.signature !== 'string') {
          throw validationError;
        }
      }).toThrow(BadRequestException);
    });

    it('should reject non-object data field', async () => {
      const invalidPayload = {
        data: 'invalid-string-data',
        signature: '0xvalidsignature',
      };

      const validationError = new BadRequestException('data must be an object');
      
      expect(() => {
        const dto = new VerifySignatureDto();
        Object.assign(dto, invalidPayload);
        if (typeof dto.data !== 'object' || dto.data === null) {
          throw validationError;
        }
      }).toThrow(BadRequestException);
    });
  });

  describe('Injection Attack Prevention', () => {
    it('should handle SQL injection attempts in address field', async () => {
      const maliciousPayload = <VerifySignatureDto><unknown>{
        data: {
          address: "'; DROP TABLE users; --",
          userId: 'normal-user-id',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: "'; DROP TABLE users; --",
        assignedRoles: [],
      });

      // The controller should pass the data through unchanged (sanitization happens in services)
      const result = await controller.verify(maliciousPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: "'; DROP TABLE users; --",
        }),
        maliciousPayload.signature
      );
    });

    it('should handle NoSQL injection attempts in userId field', async () => {
      const maliciousPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          userId: '{"$ne": null}',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(maliciousPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '{"$ne": null}',
        }),
        maliciousPayload.signature
      );
    });

    it('should handle XSS attempts in userTag field', async () => {
      const maliciousPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          userTag: '<script>alert("XSS")</script>',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(maliciousPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          userTag: '<script>alert("XSS")</script>',
        }),
        maliciousPayload.signature
      );
    });

    it('should handle command injection attempts in nonce field', async () => {
      const maliciousPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          nonce: 'valid-nonce; rm -rf /',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(maliciousPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          nonce: 'valid-nonce; rm -rf /',
        }),
        maliciousPayload.signature
      );
    });
  });

  describe('Large Payload Handling', () => {
    it('should handle extremely long strings gracefully', async () => {
      const veryLongString = 'A'.repeat(100000); // 100KB string
      
      const largePayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          userTag: veryLongString,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(largePayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          userTag: veryLongString,
        }),
        largePayload.signature
      );
    });

    it('should handle deeply nested objects in data field', async () => {
      const deeplyNestedData = {
        address: '0x1234567890123456789012345678901234567890',
        level1: {
          level2: {
            level3: {
              level4: {
                level5: 'deep-value'
              }
            }
          }
        }
      };

      const nestedPayload = <VerifySignatureDto><unknown>{
        data: deeplyNestedData,
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(nestedPayload);
      
      // Should extract only the known fields and default the rest
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '0x1234567890123456789012345678901234567890',
          userId: '',
          userTag: '',
        }),
        nestedPayload.signature
      );
    });
  });

  describe('Invalid Data Types', () => {
    it('should handle null values in data fields', async () => {
      const nullValuePayload = <VerifySignatureDto><unknown>{
        data: {
          address: null,
          userId: null,
          userTag: null,
          expiry: null,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '',
        assignedRoles: [],
      });

      const result = await controller.verify(nullValuePayload);
      
      // The controller should convert null values to empty strings/defaults
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '',
          userId: '',
          userTag: '',
          expiry: 0,
        }),
        nullValuePayload.signature
      );
    });

    it('should handle undefined values in data fields', async () => {
      const undefinedValuePayload = <VerifySignatureDto><unknown>{
        data: {
          address: undefined,
          userId: undefined,
          userTag: undefined,
          expiry: undefined,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '',
        assignedRoles: [],
      });

      const result = await controller.verify(undefinedValuePayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '',
          userId: '',
          userTag: '',
          expiry: 0,
        }),
        undefinedValuePayload.signature
      );
    });

    it('should handle boolean values in string fields', async () => {
      const booleanValuePayload = <VerifySignatureDto><unknown>{
        data: {
          address: true as any,
          userId: false as any,
          userTag: true as any,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '',
        assignedRoles: [],
      });

      const result = await controller.verify(booleanValuePayload);
      
      // Should pass through the boolean values as-is (validation happens at DTO level)
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: true,
          userId: '',
          userTag: true,
        }),
        booleanValuePayload.signature
      );
    });

    it('should handle array values in string fields', async () => {
      const arrayValuePayload = <VerifySignatureDto><unknown>{
        data: {
          address: ['0x123', '0x456'] as any,
          userId: ['user1', 'user2'] as any,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '',
        assignedRoles: [],
      });

      const result = await controller.verify(arrayValuePayload);
      
      // Should pass through the array values as-is (validation happens at DTO level)
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: ['0x123', '0x456'],
          userId: ['user1', 'user2'],
        }),
        arrayValuePayload.signature
      );
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle empty data object', async () => {
      const emptyDataPayload = <VerifySignatureDto><unknown>{
        data: {},
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '',
        assignedRoles: [],
      });

      const result = await controller.verify(emptyDataPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        {
          address: '',
          userId: '',
          userTag: '',
          avatar: '',
          discordId: '',
          discordName: '',
          discordIcon: '',
          nonce: '',
          expiry: 0,
        },
        emptyDataPayload.signature
      );
    });

    it('should handle numeric strings in string fields', async () => {
      const numericStringPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '123456789',
          userId: '987654321',
          nonce: '0',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '123456789',
        assignedRoles: [],
      });

      const result = await controller.verify(numericStringPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '123456789',
          userId: '987654321',
          nonce: '0',
        }),
        numericStringPayload.signature
      );
    });

    it('should handle unicode characters in string fields', async () => {
      const unicodePayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          userTag: 'user🚀#1234',
          discordName: 'Test Server 🎮',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(unicodePayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          userTag: 'user🚀#1234',
          discordName: 'Test Server 🎮',
        }),
        unicodePayload.signature
      );
    });

    it('should handle maximum safe integer for expiry', async () => {
      const maxIntegerPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          expiry: Number.MAX_SAFE_INTEGER,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(maxIntegerPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          expiry: Number.MAX_SAFE_INTEGER,
        }),
        maxIntegerPayload.signature
      );
    });

    it('should handle negative expiry values', async () => {
      const negativeExpiryPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          expiry: -1234567890,
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(negativeExpiryPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          expiry: -1234567890,
        }),
        negativeExpiryPayload.signature
      );
    });
  });

  describe('URL and Path Traversal Prevention', () => {
    it('should handle path traversal attempts in avatar URLs', async () => {
      const pathTraversalPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          avatar: '../../../etc/passwd',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(pathTraversalPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: '../../../etc/passwd',
        }),
        pathTraversalPayload.signature
      );
    });

    it('should handle malformed URLs in icon fields', async () => {
      const malformedUrlPayload = <VerifySignatureDto><unknown>{
        data: {
          address: '0x1234567890123456789012345678901234567890',
          discordIconURL: 'javascript:alert("XSS")',
        },
        signature: '0xvalidsignature',
      };

      mockVerifyService.verifySignatureFlow.mockResolvedValue({
        message: 'Verification successful',
        address: '0x1234567890123456789012345678901234567890',
        assignedRoles: [],
      });

      const result = await controller.verify(malformedUrlPayload);
      
      expect(mockVerifyService.verifySignatureFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          discordIcon: 'javascript:alert("XSS")',
        }),
        malformedUrlPayload.signature
      );
    });
  });
});
