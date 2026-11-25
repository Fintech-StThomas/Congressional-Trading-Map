"""The request plan of review_fec_row.py (no network)."""
import unittest
from datetime import date

from scripts.ops import review_fec_row as rf


class PlanTests(unittest.TestCase):
    def test_periods_cover_the_window(self):
        self.assertEqual(rf.periods(date(2017, 6, 20), 60, 150), [2018])
        self.assertEqual(rf.periods(date(2018, 12, 20), 60, 150), [2018, 2020])
        self.assertEqual(rf.periods(date(2019, 1, 1), 3, 3), [2018, 2020])

    def test_queries_name_both_sides_largest_first(self):
        q = rf.queries("C00341396", "C00630426", date(2017, 6, 20))
        self.assertEqual([label for label, _, _ in q], ["giver Schedule B", "recipient Schedule A"])
        b, a = q[0][2], q[1][2]
        self.assertEqual((b["committee_id"], b["recipient_committee_id"], b["sort"]), ("C00341396", "C00630426", "-disbursement_amount"))
        self.assertEqual((b["min_date"], b["max_date"]), ("2017-06-17", "2017-06-23"))
        self.assertEqual((a["committee_id"], a["contributor_id"], a["sort"]), ("C00630426", "C00341396", "-contribution_receipt_amount"))
        self.assertEqual((a["min_date"], a["max_date"]), ("2017-04-21", "2017-11-17"))

    def test_rejects_bad_arguments(self):
        self.assertEqual(rf.main(["MOVEON", "C00630426", "2017-06-20", "1"]), 2)
        self.assertEqual(rf.main([]), 2)


if __name__ == "__main__":
    unittest.main()
