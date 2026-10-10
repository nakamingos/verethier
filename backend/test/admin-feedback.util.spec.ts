import { AdminFeedback } from '../src/services/utils/admin-feedback.util';
import { EmbedBuilder } from 'discord.js';
import { VerificationRule } from '../src/models/verification-rule.interface';

/**
 * AdminFeedback Test Suite
 * 
 * Comprehensive tests for the admin feedback utility, covering:
 * - User experience and feedback generation
 * - Discord embed formatting and styling
 * - Message consistency and branding
 * - Rule formatting and display
 * - Error messages and guidance
 * - Color scheme and visual hierarchy
 * - Accessibility and readability
 */
describe('AdminFeedback', () => {
  
  // Sample verification rule for testing
  const sampleRule: VerificationRule = {
    role_id: '789012345678901234',
    slug: 'test-collection',
    attribute_key: 'Background',
    attribute_value: 'Ocean',
    min_items: 3,
    channel_id: 'test-channel-456',
  };

  describe('success', () => {
    it('should create success embed with proper formatting', () => {
      const embed = AdminFeedback.success('Rule Added', 'Your verification rule has been created successfully.');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      
      const embedData = embed.toJSON();
      expect(embedData.color).toBe(0x00FF00); // Green
      expect(embedData.title).toBe('✅ Rule Added');
      expect(embedData.description).toBe('Your verification rule has been created successfully.');
    });

    it('should handle success message without description', () => {
      const embed = AdminFeedback.success('Operation Complete');

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('✅ Operation Complete');
      expect(embedData.description).toBeUndefined();
    });

    it('should include custom fields when provided', () => {
      const fields = [
        { name: 'Role', value: '<@&123456789>', inline: true },
        { name: 'Collection', value: 'test-collection', inline: true },
      ];

      const embed = AdminFeedback.success('Rule Created', 'Success!', fields);

      const embedData = embed.toJSON();
      expect(embedData.fields).toHaveLength(2);
      expect(embedData.fields[0].name).toBe('Role');
      expect(embedData.fields[0].value).toBe('<@&123456789>');
      expect(embedData.fields[0].inline).toBe(true);
    });

    it('should maintain visual consistency across success messages', () => {
      const embed1 = AdminFeedback.success('First Success');
      const embed2 = AdminFeedback.success('Second Success');

      expect(embed1.toJSON().color).toBe(embed2.toJSON().color);
      expect(embed1.toJSON().title).toContain('✅');
      expect(embed2.toJSON().title).toContain('✅');
    });
  });

  describe('error', () => {
    it('should create error embed with proper formatting and guidance', () => {
      const actions = [
        'Check your permissions',
        'Verify the role hierarchy',
        'Try again in a few minutes',
      ];

      const embed = AdminFeedback.error(
        'Permission Denied',
        'Unable to create role due to insufficient permissions.',
        actions
      );

      const embedData = embed.toJSON();
      expect(embedData.color).toBe(0xFF0000); // Red
      expect(embedData.title).toBe('❌ Permission Denied');
      expect(embedData.description).toBe('Unable to create role due to insufficient permissions.');
      
      const guidanceField = embedData.fields.find(f => f.name === '💡 What you can do:');
      expect(guidanceField).toBeDefined();
      expect(guidanceField.value).toContain('• Check your permissions');
      expect(guidanceField.value).toContain('• Verify the role hierarchy');
      expect(guidanceField.value).toContain('• Try again in a few minutes');
    });

    it('should handle error without actions', () => {
      const embed = AdminFeedback.error(
        'Validation Failed',
        'The provided parameters are invalid.'
      );

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('❌ Validation Failed');
      expect(embedData.description).toBe('The provided parameters are invalid.');
      expect(embedData.fields).toBeUndefined();
    });

    it('should include custom fields along with actions', () => {
      const actions = ['Check the documentation'];
      const fields = [
        { name: 'Error Code', value: 'ERR_001', inline: true },
        { name: 'Timestamp', value: '2024-01-01 12:00:00', inline: true },
      ];

      const embed = AdminFeedback.error(
        'System Error',
        'An unexpected error occurred.',
        actions,
        fields
      );

      const embedData = embed.toJSON();
      expect(embedData.fields).toHaveLength(3); // 2 custom + 1 actions
      expect(embedData.fields[0].name).toBe('Error Code');
      expect(embedData.fields[1].name).toBe('Timestamp');
      expect(embedData.fields[2].name).toBe('💡 What you can do:');
    });

    it('should maintain consistent error styling', () => {
      const embed1 = AdminFeedback.error('Error 1', 'Description 1');
      const embed2 = AdminFeedback.error('Error 2', 'Description 2');

      expect(embed1.toJSON().color).toBe(0xFF0000);
      expect(embed2.toJSON().color).toBe(0xFF0000);
      expect(embed1.toJSON().title).toContain('❌');
      expect(embed2.toJSON().title).toContain('❌');
    });
  });

  describe('info', () => {
    it('should create info embed with neutral styling', () => {
      const embed = AdminFeedback.info('Server Information', 'This server has 5 verification rules.');

      const embedData = embed.toJSON();
      expect(embedData.color).toBe(0x00FF73); // Bouncer green
      expect(embedData.title).toBe('📋 Server Information');
      expect(embedData.description).toBe('This server has 5 verification rules.');
    });

    it('should handle info message without description', () => {
      const embed = AdminFeedback.info('Status Update');

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('📋 Status Update');
      expect(embedData.description).toBeUndefined();
    });

    it('should support info fields for structured data', () => {
      const fields = [
        { name: 'Total Rules', value: '12', inline: true },
        { name: 'Active Users', value: '347', inline: true },
        { name: 'Last Update', value: '5 minutes ago', inline: false },
      ];

      const embed = AdminFeedback.info('Dashboard', 'Current server statistics:', fields);

      const embedData = embed.toJSON();
      expect(embedData.fields).toHaveLength(3);
      expect(embedData.fields[2].inline).toBe(false);
    });
  });

  describe('warning', () => {
    it('should create warning embed with appropriate styling', () => {
      const actions = ['Review your configuration', 'Contact support if issues persist'];

      const embed = AdminFeedback.warning(
        'Rate Limit Approaching',
        'You are approaching Discord API rate limits.',
        actions
      );

      const embedData = embed.toJSON();
      expect(embedData.color).toBe(0xFFA500); // Orange
      expect(embedData.title).toBe('⚠️ Rate Limit Approaching');
      expect(embedData.description).toBe('You are approaching Discord API rate limits.');
      
      const actionsField = embedData.fields.find(f => f.name === '💡 What you can do:');
      expect(actionsField).toBeDefined();
      expect(actionsField.value).toContain('Review your configuration');
    });

    it('should handle warnings without action guidance', () => {
      const embed = AdminFeedback.warning(
        'Maintenance Mode',
        'Some features may be temporarily unavailable.'
      );

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('⚠️ Maintenance Mode');
      expect(embedData.fields).toBeUndefined();
    });
  });

  describe('simple', () => {
    it('should format simple success messages', () => {
      const message = AdminFeedback.simple('Operation completed successfully');

      expect(message).toBe('✅ Operation completed successfully');
    });

    it('should format simple error messages', () => {
      const message = AdminFeedback.simple('Something went wrong', true);

      expect(message).toBe('❌ Something went wrong');
    });

    it('should handle empty messages gracefully', () => {
      const emptyMessage = AdminFeedback.simple('');
      const emptyError = AdminFeedback.simple('', true);

      expect(emptyMessage).toBe('✅ ');
      expect(emptyError).toBe('❌ ');
    });
  });

  describe('formatRule', () => {
    it('should format rule with all details', () => {
      const formatted = AdminFeedback.formatRule(sampleRule, 'Test Rule');

      expect(formatted).toContain('**Test Rule**');
      expect(formatted).toContain('**Role:** <@&789012345678901234>');
      expect(formatted).toContain('**Collection:** test-collection');
      expect(formatted).toContain('**Attribute:** Background=Ocean');
      expect(formatted).toContain('**Min Items:** 3');
    });

    it('should format rule without title', () => {
      const formatted = AdminFeedback.formatRule(sampleRule);

      expect(formatted).not.toContain('**Test Rule**');
      expect(formatted).toContain('**Role:** <@&789012345678901234>');
      expect(formatted).toContain('**Collection:** test-collection');
    });

    it('should handle ALL attribute key', () => {
      const ruleWithAllKey: VerificationRule = {
        ...sampleRule,
        attribute_key: 'ALL',
        attribute_value: 'Rare',
      };

      const formatted = AdminFeedback.formatRule(ruleWithAllKey);

      expect(formatted).toContain('**Attribute:** ANY_KEY=Rare');
    });

    it('should handle ALL attribute value', () => {
      const ruleWithAllValue: VerificationRule = {
        ...sampleRule,
        attribute_key: 'Rarity',
        attribute_value: 'ALL',
      };

      const formatted = AdminFeedback.formatRule(ruleWithAllValue);

      expect(formatted).toContain('**Attribute:** Rarity (any value)');
    });

    it('should handle both ALL key and value', () => {
      const ruleWithAllBoth: VerificationRule = {
        ...sampleRule,
        attribute_key: 'ALL',
        attribute_value: 'ALL',
      };

      const formatted = AdminFeedback.formatRule(ruleWithAllBoth);

      expect(formatted).toContain('**Attribute:** ALL');
    });

    it('should handle rules with missing optional fields', () => {
      const minimalRule: VerificationRule = {
        role_id: 'role123',
        slug: 'collection',
        attribute_key: 'Color',
        attribute_value: 'Blue',
        min_items: 1,
      };

      const formatted = AdminFeedback.formatRule(minimalRule);

      expect(formatted).toContain('**Role:** <@&role123>');
      expect(formatted).toContain('**Collection:** collection');
      expect(formatted).toContain('**Min Items:** 1');
    });
  });

  describe('formatRuleList', () => {
    it('should format multiple rules with separators', () => {
      const rules: VerificationRule[] = [
        sampleRule,
        {
          ...sampleRule,
          role_id: 'role456',
          attribute_key: 'Eyes',
          attribute_value: 'Laser',
        },
      ];

      const embed = AdminFeedback.formatRuleList(rules, 'verification');

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('📋 Verification Rules for #verification');
      expect(embedData.description).toContain('Rule 1:');
      expect(embedData.description).toContain('Rule 2:');
      expect(embedData.description).toContain('─'.repeat(25)); // Separator
    });

    it('should handle empty rule list', () => {
      const embed = AdminFeedback.formatRuleList([]);

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('📋 Verification Rules');
      expect(embedData.description).toBe('No verification rules found for this channel.\nUse `/setup add-rule` to create your first rule!');
    });

    it('should handle single rule without separator', () => {
      const embed = AdminFeedback.formatRuleList([sampleRule], 'general');

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('📋 Verification Rules for #general');
      expect(embedData.description).toContain('Rule 1:');
      expect(embedData.description).not.toContain('─'.repeat(25));
    });

    it('should format rules without channel name', () => {
      const embed = AdminFeedback.formatRuleList([sampleRule]);

      const embedData = embed.toJSON();
      expect(embedData.title).toBe('📋 Verification Rules');
    });
  });

  describe('color scheme and accessibility', () => {
    it('should use consistent color scheme', () => {
      const successEmbed = AdminFeedback.success('Success');
      const errorEmbed = AdminFeedback.error('Error', 'Description');
      const infoEmbed = AdminFeedback.info('Info');
      const warningEmbed = AdminFeedback.warning('Warning', 'Description');

      expect(successEmbed.toJSON().color).toBe(0x00FF00); // Green
      expect(errorEmbed.toJSON().color).toBe(0xFF0000);   // Red
      expect(infoEmbed.toJSON().color).toBe(0x00FF73);   // Bouncer green
      expect(warningEmbed.toJSON().color).toBe(0xFFA500);  // Orange
    });

    it('should use appropriate emojis for visual clarity', () => {
      const successTitle = AdminFeedback.success('Test').toJSON().title;
      const errorTitle = AdminFeedback.error('Test', 'desc').toJSON().title;
      const infoTitle = AdminFeedback.info('Test').toJSON().title;
      const warningTitle = AdminFeedback.warning('Test', 'desc').toJSON().title;

      expect(successTitle).toContain('✅');
      expect(errorTitle).toContain('❌');
      expect(infoTitle).toContain('📋');
      expect(warningTitle).toContain('⚠️');
    });

    it('should maintain readability with proper field structure', () => {
      const embed = AdminFeedback.error(
        'Complex Error',
        'Multiple issues detected.',
        ['Action 1', 'Action 2'],
        [
          { name: 'Field 1', value: 'Value 1', inline: true },
          { name: 'Field 2', value: 'Value 2', inline: false },
        ]
      );

      const embedData = embed.toJSON();
      expect(embedData.fields).toHaveLength(3); // 2 custom + 1 actions
      expect(embedData.fields[2].name).toBe('💡 What you can do:');
      expect(embedData.fields[2].inline).toBe(false);
    });
  });

  describe('user experience and guidance', () => {
    it('should provide actionable guidance in error messages', () => {
      const actions = [
        'Ensure the bot has "Manage Roles" permission',
        'Move the bot role above the target role in role hierarchy',
        'Check that the role name doesn\'t conflict with existing roles',
      ];

      const embed = AdminFeedback.error(
        'Role Creation Failed',
        'Unable to create the verification role.',
        actions
      );

      const embedData = embed.toJSON();
      const guidanceField = embedData.fields[0];
      
      expect(guidanceField.name).toBe('💡 What you can do:');
      actions.forEach(action => {
        expect(guidanceField.value).toContain(`• ${action}`);
      });
    });

    it('should handle complex formatting scenarios', () => {
      const complexRule: VerificationRule = {
        role_id: '999888777666555444',
        slug: 'very-long-collection-name-that-might-wrap',
        attribute_key: 'Very Long Attribute Key Name',
        attribute_value: 'Very Long Attribute Value That Might Cause Issues',
        min_items: 100,
        channel_id: 'complex-channel',
      };

      const formatted = AdminFeedback.formatRule(complexRule, 'Complex Rule Test');

      expect(formatted).toContain('Complex Rule Test');
      expect(formatted).toContain('very-long-collection-name-that-might-wrap');
      expect(formatted).toContain('Very Long Attribute Key Name=Very Long Attribute Value That Might Cause Issues');
      expect(formatted).toContain('100');
    });

    it('should maintain message clarity with empty or null values', () => {
      const ruleWithEmptyValues: VerificationRule = {
        role_id: '',
        slug: '',
        attribute_key: '',
        attribute_value: '',
        min_items: 0,
      };

      const formatted = AdminFeedback.formatRule(ruleWithEmptyValues);

      expect(formatted).toContain('**Role:** <@&>');
      expect(formatted).toContain('**Collection:** ');
      expect(formatted).toContain('**Min Items:** 0');
    });

    it('should provide helpful empty state messages', () => {
      const emptyListEmbed = AdminFeedback.formatRuleList([]);

      const embedData = emptyListEmbed.toJSON();
      expect(embedData.description).toContain('No verification rules found');
      expect(embedData.description).toContain('/setup add-rule');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle extremely long text gracefully', () => {
      const longText = 'a'.repeat(2000);
      const embed = AdminFeedback.success('Long Text Test', longText);

      // Discord embeds have length limits, but our utility should not crash
      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.toJSON().description).toBe(longText);
    });

    it('should handle special characters in rule formatting', () => {
      const specialRule: VerificationRule = {
        ...sampleRule,
        slug: 'collection-with-unicode-🚀',
        attribute_key: 'Attribute with "quotes" and <tags>',
        attribute_value: 'Value with & ampersands & more',
      };

      const formatted = AdminFeedback.formatRule(specialRule);

      expect(formatted).toContain('collection-with-unicode-🚀');
      expect(formatted).toContain('Attribute with "quotes" and <tags>');
      expect(formatted).toContain('Value with & ampersands & more');
    });

    it('should handle null/undefined inputs gracefully', () => {
      // These should not crash even with invalid inputs
      expect(() => AdminFeedback.simple(null as any)).not.toThrow();
      expect(() => AdminFeedback.simple(undefined as any)).not.toThrow();
      
      const nullMessage = AdminFeedback.simple(null as any);
      const undefinedMessage = AdminFeedback.simple(undefined as any);
      
      expect(nullMessage).toContain('✅');
      expect(undefinedMessage).toContain('✅');
    });
  });
});
