"""Mutation checks: a plausible summary must not hide omitted annual rows or transitions."""
from copy import deepcopy

from pipeline.holdings import positions, profile, validate_positions


class Checks:
    def __init__(self):
        self.fail = []

    def check(self, ok, label, detail=""):
        if not ok:
            self.fail.append(label)


def fixture():
    years = {}
    for y in (2020, 2022):
        row = ["r", "Example (EX)", "EX", "printed", "co:1", "stock", "joint", 1001, 15000,
               None, None, None, None, str(y)]
        years[str(y)] = {"doc": str(y), "assets": {"rows": [row]}, "liabilities": {"rows": []},
                         "totals": {"assets": {"low": 1001, "high": 15000}, "liabilities": {"low": 0, "high": 0},
                                    "liabilities_residence_secured": {"low": 0, "high": 0}},
                         "net_worth": {"low": 1001, "high": 15000, "high_valued": 15000, "label": "range"}}
    coverage = [{"year": y, "status": "used" if y != 2021 else "no_annual_report_in_dataset"} for y in (2020, 2021, 2022)]
    pos = {"member": "X000001", "coverage": coverage, "docs": {str(y): f"https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{y}/{y}.pdf" for y in (2020, 2022)},
           **positions.build(years, None, {})}
    holding = {"years": years, "coverage": coverage, "docs": {str(y): {"used": True} for y in (2020, 2022)},
               "positions_summary": deepcopy(pos["summary"]), "tenure_change": profile.tenure_change(years),
               "leverage": profile.leverage(years)}
    return holding, pos


def test_valid_timeline_and_missing_transition(monkeypatch, tmp_path):
    monkeypatch.setattr(validate_positions, "OUT", tmp_path)
    holding, pos = fixture()
    c = Checks()
    validate_positions.check_member(c, "X000001", holding, pos, [])
    assert not c.fail
    pos["transitions"]["rows"] = []
    pos["summary"]["transitions"]["unchanged"] = 0
    holding["positions_summary"] = deepcopy(pos["summary"])
    c = Checks()
    validate_positions.check_member(c, "X000001", holding, pos, [])
    assert "transitions complete and unique" in c.fail


def test_duplicated_annual_row_and_gap(monkeypatch, tmp_path):
    monkeypatch.setattr(validate_positions, "OUT", tmp_path)
    holding, pos = fixture()
    pos["snapshots"]["rows"][0][8].append("r")
    pos["transitions"]["rows"][0][3] = 0
    c = Checks()
    validate_positions.check_member(c, "X000001", holding, pos, [])
    assert "snapshots partition all annual asset rows" in c.fail
    assert "transition gap and owner change" in c.fail
