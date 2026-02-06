# Python 3.5
from __future__ import print_function

import sys

from . import run_standalone


def main() -> None:
    run_standalone(sys.argv[1:])


if __name__ == "__main__":
    main()
