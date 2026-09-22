import unittest

from email_parser import EmailMessage, EmailTicketParser, Ticket


def ticket_value():
    return {
        "id": "TCK-1042", "email_id": "EMAIL-1042", "received_at": "2026-09-22T09:14:00+02:00",
        "raw_email": "Customers see A17 in mobile banking.", "summary": "Mobile users cannot log into E-Banking.",
        "ontology_values": {
            "actor_ids": ["actor:user"], "platform_ids": ["platform:e_banking"], "server_ids": [], "supplier_ids": [],
            "edge_ids": ["edge:user_login_ebanking"], "relationship_types": ["LOGS_INTO"],
            "primary_affected_node_id": "platform:e_banking", "symptom": "login_failure", "region": "CH",
            "channel": "mobile_ios", "environment": "production", "error_code": "A17", "release_id": None,
        },
        "extraction": {"confidence": 0.96, "evidence": ["Customers", "A17"]},
    }


class TicketTests(unittest.TestCase):
    def test_accepts_ontology_ticket(self):
        ticket = Ticket.from_dict(ticket_value())
        self.assertEqual(ticket.ontology_values.platform_ids, ["platform:e_banking"])
        self.assertEqual(ticket.to_dict(), ticket_value())

    def test_rejects_unknown_fields(self):
        value = ticket_value()
        value["category"] = "access"
        with self.assertRaises(ValueError):
            Ticket.from_dict(value)

    def test_rejects_id_outside_ontology(self):
        value = ticket_value()
        value["ontology_values"]["platform_ids"] = ["platform:invented"]
        with self.assertRaises(ValueError):
            Ticket.from_dict(value)

    def test_parser_supplies_envelope_and_preserves_email(self):
        class FakeGenerator:
            call = None

            def generate(self, text, **metadata):
                self.call = (text, metadata)
                value = ticket_value()
                value.update({"id": metadata["ticket_id"], "email_id": metadata["email_id"], "received_at": metadata["received_at"]})
                value["raw_email"] = text
                return Ticket.from_dict(value)

        generator = FakeGenerator()
        ticket = EmailTicketParser(generator).parse_email(EmailMessage("E-Banking access", "I see A17", "alex@example.com", "EMAIL-1042", "2026-09-22T09:14:00+02:00"))
        self.assertEqual(ticket.id, "TCK-1042")
        self.assertIn("Subject: E-Banking access", ticket.raw_email)
        self.assertIn("From: alex@example.com", ticket.raw_email)


if __name__ == "__main__":
    unittest.main()
