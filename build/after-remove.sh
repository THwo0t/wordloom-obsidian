#!/bin/sh
set -e

if [ "$(readlink /usr/bin/wordloom 2>/dev/null || true)" = "/opt/Wordloom/wordloom" ]; then
  rm -f /usr/bin/wordloom
fi

if [ -f /usr/bin/wl ] && grep -q '^exec /opt/Wordloom/wordloom --quick' /usr/bin/wl; then
  rm -f /usr/bin/wl
fi
