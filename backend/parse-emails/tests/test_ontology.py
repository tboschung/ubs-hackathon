import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ONTOLOGY_PATH = ROOT / "static" / "ontology" / "ontology.json"
ONTOLOGY_PAGE = ROOT / "static" / "ontology" / "index.html"

NODE_TYPES = {"actor", "platform", "server"}
RELATIONSHIP_TYPES = {
    "LOGS_INTO",
    "PAYS",
    "VIA",
    "DEPENDS_ON",
    "PROVIDED_BY",
    "OPERATED_BY",
}


class OntologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.value = json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))

    def test_contains_expected_graph_size(self):
        self.assertEqual(self.value["version"], "1.0")
        self.assertEqual(len(self.value["nodes"]), 7)
        self.assertEqual(len(self.value["edges"]), 6)

    def test_ids_are_unique_and_edges_reference_existing_nodes(self):
        node_ids = [node["id"] for node in self.value["nodes"]]
        edge_ids = [edge["id"] for edge in self.value["edges"]]

        self.assertEqual(len(node_ids), len(set(node_ids)))
        self.assertEqual(len(edge_ids), len(set(edge_ids)))
        self.assertTrue(set(node_ids).isdisjoint(edge_ids))

        known_nodes = set(node_ids)
        for edge in self.value["edges"]:
            self.assertIn(edge["source"], known_nodes)
            self.assertIn(edge["target"], known_nodes)

    def test_nodes_and_relationships_use_controlled_values(self):
        for node in self.value["nodes"]:
            self.assertIn(node["type"], NODE_TYPES)
            self.assertIsInstance(node["aliases"], list)
            self.assertTrue(node["label"].strip())

        for edge in self.value["edges"]:
            self.assertIn(edge["relationship"], RELATIONSHIP_TYPES)
            self.assertIsInstance(edge["metadata"], dict)

    def test_server_has_platform_dependency_and_supplier_provenance(self):
        edges = {edge["id"]: edge for edge in self.value["edges"]}

        dependency = edges["edge:ebanking_depends_on_server"]
        self.assertEqual(dependency["source"], "platform:e_banking")
        self.assertEqual(dependency["target"], "server:ebanking_primary")
        self.assertEqual(dependency["relationship"], "DEPENDS_ON")

        provenance = edges["edge:server_provided_by_supplier"]
        self.assertEqual(provenance["source"], "server:ebanking_primary")
        self.assertEqual(provenance["target"], "actor:supplier")
        self.assertEqual(provenance["relationship"], "PROVIDED_BY")

    def test_page_uses_only_the_local_cytoscape_asset(self):
        page = ONTOLOGY_PAGE.read_text(encoding="utf-8")
        self.assertIn('src="vendor/cytoscape.min.js"', page)
        self.assertNotIn("unpkg.com", page)
        self.assertNotIn("cdn.jsdelivr.net", page)


if __name__ == "__main__":
    unittest.main()
