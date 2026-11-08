import unittest
from worker.graph_projection import (
    compute_deterministic_projection_key,
    load_initial_acceptance_dataset,
    verify_live_typedb_grpc,
)


class TestGraphProjectionWorker(unittest.TestCase):
    def test_deterministic_projection_key_and_dataset_integrity(self) -> None:
        dataset = load_initial_acceptance_dataset()
        self.assertGreaterEqual(len(dataset["organisations"]), 6)
        self.assertGreaterEqual(len(dataset["relationships"]), 10)

        rel = dataset["relationships"][0]
        key1 = compute_deterministic_projection_key(
            dataset["owner"], dataset["visibility"], rel
        )
        key2 = compute_deterministic_projection_key(
            dataset["owner"], dataset["visibility"], rel
        )
        self.assertEqual(key1, key2)
        self.assertTrue(key1.startswith("proj:"))
        self.assertEqual(len(key1), 5 + 64)

    def test_live_typedb_grpc_driver_verification(self) -> None:
        dataset = load_initial_acceptance_dataset()
        report = verify_live_typedb_grpc()
        self.assertTrue(report["connected"])
        if report["databaseExists"]:
            self.assertEqual(
                report["organisationCount"], len(dataset["organisations"])
            )
            self.assertEqual(
                report["relationshipCount"], len(dataset["relationships"])
            )


if __name__ == "__main__":
    unittest.main()
