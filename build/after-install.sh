#!/bin/sh
set -e

ln -sfn /opt/Wordloom/wordloom /usr/bin/wordloom
install -m 0755 /opt/Wordloom/resources/wl /usr/bin/wl
