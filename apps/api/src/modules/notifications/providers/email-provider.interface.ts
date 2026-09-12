export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Replaceable email transport abstraction (§9/§10) - NotificationsModule
 * selects SmtpEmailProvider when EMAIL_ENABLED=true and an SMTP host is
 * configured, otherwise LoggingEmailProvider, so the application never
 * crashes or blocks delivery merely because no SMTP provider exists in this
 * environment. Nothing outside NotificationsModule ever imports a concrete
 * provider directly - only this interface.
 */
export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}
