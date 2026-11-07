import argparse
import json
import sys
from pathlib import Path
from .research import evaluate
from .store import import_prices


def main():
    parser = argparse.ArgumentParser(description="Benchmark 001 offline research worker")
    commands = parser.add_subparsers(dest="command", required=True)
    evaluation = commands.add_parser("evaluate")
    evaluation.add_argument("input", help="JSON file or - for stdin")
    evaluation.add_argument("--output")
    prices = commands.add_parser("import-prices")
    prices.add_argument("csv")
    prices.add_argument("--database", required=True)
    args = parser.parse_args()
    try:
        if args.command == "evaluate":
            raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8-sig")
            result = evaluate(json.loads(raw))
        else:
            result = import_prices(args.csv, args.database)
        output = json.dumps(result, indent=2, allow_nan=False)
        if getattr(args, "output", None):
            Path(args.output).write_text(output + "\n", encoding="utf-8")
        else:
            print(output)
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
