#!/usr/bin/env python
"""
scripts/.lib/port-in-use.py — testa se (host, port) está ocupada via bind().

Uso: port-in-use.py <host> <port>
Exit: 0 = ocupada, 1 = livre, 2 = erro de uso
"""
import socket
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(f"uso: {sys.argv[0]} <host> <port>", file=sys.stderr)
        return 2

    host = sys.argv[1]
    try:
        port = int(sys.argv[2])
    except ValueError:
        print(f"port inválido: {sys.argv[2]}", file=sys.stderr)
        return 2

    candidates = []
    if ":" in host:
        candidates.append((socket.AF_INET6, host, port))
    else:
        candidates.append((socket.AF_INET, host, port))
        candidates.append((socket.AF_INET6, "::1", port))

    saw_eaddrinuse = False
    for fam, h, p in candidates:
        try:
            s = socket.socket(fam, socket.SOCK_STREAM)
            s.bind((h, p))
            s.close()
        except OSError as e:
            if e.errno in (10048, 98):
                saw_eaddrinuse = True
        except Exception:
            pass

    return 0 if saw_eaddrinuse else 1


if __name__ == "__main__":
    sys.exit(main())
