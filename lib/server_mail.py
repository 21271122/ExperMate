"""服务端邮件发送；验证码只发往邮箱，不回显给浏览器。"""
import smtplib
from email.message import EmailMessage


class SMTPMailSender:
    def __init__(self, config):
        self.config = config

    def send(self, to, subject, body):
        config = self.config
        message = EmailMessage()
        message["From"] = config.get("SMTP_FROM") or config.get("SMTP_USERNAME")
        message["To"], message["Subject"] = to, subject
        message.set_content(body)
        with smtplib.SMTP(config["SMTP_HOST"], int(config.get("SMTP_PORT", 587)), timeout=20) as smtp:
            smtp.starttls()
            if config.get("SMTP_USERNAME"):
                smtp.login(config["SMTP_USERNAME"], config.get("SMTP_PASSWORD", ""))
            smtp.send_message(message)
