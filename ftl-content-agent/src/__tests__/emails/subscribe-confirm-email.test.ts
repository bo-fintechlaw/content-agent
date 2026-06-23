import { renderSubscribeConfirmEmail } from '../../emails/subscribe-confirm-email.js';
import {
  NEWSLETTER_FOOTER_DISCLAIMER,
  NEWSLETTER_PHYSICAL_ADDRESS,
  NEWSLETTER_SEGMENT_TITLE_PREFIX,
} from '../../constants/newsletter-brand.js';

describe('renderSubscribeConfirmEmail', () => {
  const confirmUrl = 'https://content-agent.fintechlaw.ai/api/subscribe/confirm?token=abc';

  it('renders branded HTML with segment cards for both newsletters', () => {
    const { subject, html, text } = renderSubscribeConfirmEmail({
      confirmUrl,
      segments: ['financial_services', 'tech_ai_legal'],
      consentText: 'Test consent copy.',
    });

    expect(subject).toContain('Confirm your FinTech Law newsletter subscriptions');
    expect(html).toContain('Confirm your subscription');
    expect(html).toContain(NEWSLETTER_SEGMENT_TITLE_PREFIX.financial_services);
    expect(html).toContain('Financial Services regulatory intelligence');
    expect(html).toContain(NEWSLETTER_SEGMENT_TITLE_PREFIX.tech_ai_legal);
    expect(html).toContain('Tech, AI &amp; legal engineering for startups');
    expect(html).toContain('#D41367');
    expect(html).toContain('Confirm subscription');
    expect(html).toContain(confirmUrl);
    expect(html).toContain(NEWSLETTER_FOOTER_DISCLAIMER.slice(0, 40));
    expect(html).toContain(NEWSLETTER_PHYSICAL_ADDRESS);
    expect(html).toContain('Test consent copy.');
    expect(html).toContain('<span style="color:#D41367;">FinTech</span>');
    expect(text).toContain(NEWSLETTER_SEGMENT_TITLE_PREFIX.financial_services);
    expect(text).toContain(confirmUrl);
  });

  it('uses logo URL when provided', () => {
    const logoUrl = 'https://fintechlaw.ai/logo.png';
    const { html } = renderSubscribeConfirmEmail({
      confirmUrl,
      segments: ['financial_services'],
      logoUrl,
    });

    expect(html).toContain(logoUrl);
    expect(html).not.toContain('<span style="color:#D41367;">FinTech</span>');
  });
});
