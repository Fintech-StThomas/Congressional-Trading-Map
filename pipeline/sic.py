"""SIC major groups (first two digits of a 4-digit SIC code), used as the org sector label."""
from __future__ import annotations

MAJOR_GROUPS: dict[int, str] = {
    1: "Agricultural production: crops", 2: "Agricultural production: livestock", 7: "Agricultural services",
    8: "Forestry", 9: "Fishing, hunting and trapping", 10: "Metal mining", 12: "Coal mining",
    13: "Oil and gas extraction", 14: "Nonmetallic minerals mining", 15: "Building construction",
    16: "Heavy construction", 17: "Construction special trade contractors", 20: "Food products",
    21: "Tobacco products", 22: "Textile mill products", 23: "Apparel", 24: "Lumber and wood products",
    25: "Furniture and fixtures", 26: "Paper products", 27: "Printing and publishing",
    28: "Chemicals and pharmaceuticals", 29: "Petroleum refining", 30: "Rubber and plastics",
    31: "Leather products", 32: "Stone, clay and glass products", 33: "Primary metals",
    34: "Fabricated metal products", 35: "Industrial machinery and computer equipment",
    36: "Electronic and electrical equipment", 37: "Transportation equipment",
    38: "Instruments and medical devices", 39: "Miscellaneous manufacturing", 40: "Railroads",
    41: "Local and interurban transit", 42: "Trucking and warehousing", 44: "Water transportation",
    45: "Air transportation", 46: "Pipelines", 47: "Transportation services", 48: "Communications",
    49: "Electric, gas and sanitary services", 50: "Wholesale: durable goods", 51: "Wholesale: nondurable goods",
    52: "Building materials retail", 53: "General merchandise stores", 54: "Food stores",
    55: "Auto dealers and gas stations", 56: "Apparel stores", 57: "Home furniture and electronics stores",
    58: "Eating and drinking places", 59: "Miscellaneous retail", 60: "Banking", 61: "Credit institutions",
    62: "Securities and commodities brokers", 63: "Insurance carriers", 64: "Insurance agents",
    65: "Real estate", 67: "Holding and investment offices", 70: "Hotels and lodging", 72: "Personal services",
    73: "Business services and software", 75: "Auto repair and services", 76: "Miscellaneous repair",
    78: "Motion pictures", 79: "Amusement and recreation", 80: "Health services", 81: "Legal services",
    82: "Educational services", 83: "Social services", 86: "Membership organizations",
    87: "Engineering, accounting and management services", 89: "Miscellaneous services",
    91: "Public administration", 99: "Nonclassifiable",
}

# SIC codes used by pooled vehicles that file 10-K/10-Q (commodity pools, unit investment trusts).
POOLED_VEHICLE_SIC = {6221, 6726}


def sector(sic: int | None) -> str | None:
    if not sic:
        return None
    return MAJOR_GROUPS.get(sic // 100)
