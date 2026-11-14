# Run by dotagents-sidebar's terminal sessions in place of ~/.bashrc: it loads ~/.bashrc, then reports
# the current folder (OSC 7) at every prompt, which the session's title shows.
[ -f ~/.bashrc ] && . ~/.bashrc
__dotagents_cwd() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__dotagents_cwd "${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="__dotagents_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi
