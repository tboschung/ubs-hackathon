import unittest

from email_parser import EmailMessage, EmailTicketParser, Ticket


class TicketTests(unittest.TestCase):
    def test_accepts_valid_ticket(self):
        value = {"title":"CRM login fails", "description":"Users see 403.", "category":"access", "urgency":"high", "affected_system":"CRM", "suggested_action":"Check identity provider logs."}
        self.assertEqual(Ticket.from_dict(value).title, "CRM login fails")

    def test_rejects_unknown_fields(self):
        with self.assertRaises(ValueError):
            Ticket.from_dict({"title":"x"})

    def test_rejects_invalid_enum(self):
        value = {"title":"x", "description":"x", "category":"random", "urgency":"high", "affected_system":"x", "suggested_action":"x"}
        with self.assertRaises(ValueError):
            Ticket.from_dict(value)

    def test_parser_formats_email_for_generator(self):
        class FakeGenerator:
            text = ""
            def generate(self, text):
                self.text = text
                return Ticket("Login fails", "403 error", "access", "high", "CRM", "Check SSO")

        generator = FakeGenerator()
        ticket = EmailTicketParser(generator).parse_email(EmailMessage("CRM access", "I see 403", "alex@example.com"))
        self.assertEqual(ticket.category, "access")
        self.assertIn("Subject: CRM access", generator.text)
        self.assertIn("From: alex@example.com", generator.text)


if __name__ == "__main__":
    unittest.main()
