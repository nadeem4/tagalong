"""The one wording table for Settings > Permissions: a plain name, a one-line sentence and a
short "about" text for every tool Scout can use, in the groups Home shows them in.

Copied verbatim from docs/superpowers/specs/design-refresh/permission-wording.html. Keyed by the
tool's short name (the part after `__`), so built-in, desktop and browser tools share one table; an
app's tools never use it and fall back to their own description. The model-facing descriptions
are not touched by any of this.
"""

# ruff: noqa: E501 - the wording is copied verbatim, one string per line, so it stays diffable
from dataclasses import dataclass


@dataclass(frozen=True)
class Words:
    title: str
    line: str
    info: str
    group: str


@dataclass(frozen=True)
class Group:
    id: str
    title: str
    note: str


GROUPS: tuple[Group, ...] = (
    Group("memory", "Memory", "Things Scout keeps between chats."),
    Group("timers", "Timers and watches", "Scout coming back to something later."),
    Group("jobs", "Jobs and experts", "Bigger work Scout hands to an expert such as Claude Code."),
    Group("talking", "Talking with you", "How Scout asks and offers."),
    Group(
        "held", "Held items", "Open threads Scout holds for you, such as emails that need a reply."
    ),
    Group("setup", "Setting things up", "Finding and adding experts and apps."),
    Group("web", "The web", "Runs on Anthropic's side, so there's no Ask option: Off or Auto."),
    Group(
        "computer",
        "This computer",
        "Windows and files. File tools only work inside folders you allowed.",
    ),
    Group(
        "browser",
        "Your browser",
        "Shown once the browser add-on is connected; the group is named after your browser.",
    ),
)

WORDS: dict[str, Words] = {
    "remember": Words(
        "Remember things",
        "Saves facts and instructions you want kept.",
        'Scout writes down things worth keeping between chats: a preference, a fact about you, notes on a project. You can see and delete all of it in Home → Memory. Example: "Remember I\'m off on Fridays."',
        "memory",
    ),
    "recall": Words(
        "Look back in memory",
        "Searches saved notes, past chats and past jobs.",
        "When something may have come up before, Scout searches what it saved, your earlier conversations and finished jobs. It only reads; nothing changes.",
        "memory",
    ),
    "forget": Words(
        "Forget something",
        "Deletes a saved note that's wrong or out of date.",
        "Scout removes one saved note when it's wrong, old, or you ask. Once deleted it's gone, but you can always tell Scout again.",
        "memory",
    ),
    "get_to_know_me": Words(
        "Get to know you",
        "Reads your public profiles to learn who you are.",
        "When you say yes (or press Get to know me in Home), Scout reads your public GitHub profile and the web, plus a LinkedIn PDF if you give one. It keeps only facts it can quote, and writes a short portrait you can see in Home → Memory. It uses a little of your daily spending limit.",
        "memory",
    ),
    "rewrite_portrait": Words(
        "Rewrite your portrait",
        "Writes the short portrait of you again from saved facts.",
        "After a fact is corrected or forgotten, Scout writes the portrait again using only the facts it still has. Facts you keep for when you ask never go in it.",
        "memory",
    ),
    "read_output": Words(
        "Read long results",
        "Reads the rest of a long result, a page at a time.",
        "Some results are too long to take in at once, so Scout first gets a preview. This lets it read the rest in pages. It only reads results Scout already has.",
        "memory",
    ),
    "set_timer": Words(
        "Set timers",
        "Reminds Scout to come back to something later.",
        "Scout sets a timer with a note to itself, once or on repeat (every 5 minutes at most). When it goes off, Scout picks the note up again, for example to remind you of a call or check on a job. See them in Home → Tasks → Timers.",
        "timers",
    ),
    "list_timers": Words(
        "See timers",
        "Lists the timers Scout has set.",
        "Shows every timer, soonest first, so Scout can tell you what's coming up or which one to cancel. It only reads.",
        "timers",
    ),
    "cancel_timer": Words(
        "Cancel timers",
        "Stops a timer before it goes off.",
        "Scout cancels one timer, usually because you asked or it's no longer needed. You can also cancel timers yourself in Home → Tasks → Timers.",
        "timers",
    ),
    "watch": Words(
        "Keep watch",
        "Checks on something on a schedule until stopped.",
        'A repeating check, like "look at the build every 30 minutes". Scout can add, pause, resume or cancel these. Each check uses a little of your daily spending limit.',
        "timers",
    ),
    "hand_off": Words(
        "Hand work to an expert",
        "Sends a task to an expert like Claude Code.",
        "For bigger work, Scout passes the task to an expert that works in a folder on your computer and reports back. Scout always asks which folder, and you choose how much freedom the expert gets.",
        "jobs",
    ),
    "work_status": Words(
        "Check on work",
        "Sees what's running, finished or stuck.",
        "Scout looks at its open jobs and timers, and anything that ended or got stuck since it last told you. It only reads.",
        "jobs",
    ),
    "watch_job": Words(
        "Set a job checklist",
        "Lists what a job must get done, then ticks items off.",
        'Right after starting a job, Scout writes a short checklist of what should happen (for example "tests pass"). It ticks items as the expert reports. You see it on the job page.',
        "jobs",
    ),
    "tell_expert": Words(
        "Message a running expert",
        "Sends a follow-up note to an expert mid-job.",
        'Scout passes a note to an expert that\'s still working, for example "also update the README". The expert reads it after its current step.',
        "jobs",
    ),
    "job_report": Words(
        "Read an expert's report",
        "Reads the full report an expert wrote.",
        "The job page shows a short version of each expert's report. This lets Scout read the whole thing when it needs the detail. It only reads.",
        "jobs",
    ),
    "set_job_result": Words(
        "Write a job's summary",
        "Writes the summary you see first on a job.",
        "When a job finishes, Scout writes up what got done, what needs you, and the key files or links, in its own words. It can rewrite it later.",
        "jobs",
    ),
    "resolve_step": Words(
        "Fix a stuck step",
        "Retries, skips or stops a step that failed.",
        "When part of a job gives up or gets stuck, Scout can run it again, skip it, or stop the whole job. It checks with you first unless you already said what to do.",
        "jobs",
    ),
    "stop_job": Words(
        "Stop a job",
        "Stops an expert that's still working.",
        "Scout stops a running job, or one part of it. Work already done stays where it is.",
        "jobs",
    ),
    "close_job": Words(
        "Close a job",
        "Marks a job finished, or failed.",
        "When Scout judges a job done, it closes it. The job stays in your list with its result; nothing more can be added to it.",
        "jobs",
    ),
    "answer_expert": Words(
        "Answer an expert",
        "Replies to an expert's question when Scout knows.",
        "Experts sometimes stop to ask something. If Scout can answer well from what it knows about you and the task, it replies; otherwise it asks you.",
        "jobs",
    ),
    "pass_question": Words(
        "Pass a question to you",
        "Brings you an expert's question that needs your call.",
        "When an expert's question needs your choice, Scout shows it to you instead of guessing.",
        "jobs",
    ),
    "list_experts": Words(
        "See installed experts",
        "Lists the experts on this computer.",
        "Shows which experts are installed and whether each is signed in. It only reads.",
        "jobs",
    ),
    "choose": Words(
        "Offer choices",
        "Shows you clickable options with its pick.",
        "Instead of a long question, Scout shows a few buttons and marks the one it recommends. Your answer comes back when you click.",
        "talking",
    ),
    "save_preference": Words(
        "Offer to remember a choice",
        "Asks if a choice should become a standing rule.",
        "After you make the same call a few times, Scout may offer to remember it so it stops asking. Nothing is saved unless you click Save it.",
        "talking",
    ),
    "loops_open": Words(
        "See what's held",
        "Lists the open items Scout is holding for you.",
        "Scout keeps track of open threads, like an email waiting on your reply or a promise with a date. This lists them. You see the same list in Home → Tasks → Held.",
        "held",
    ),
    "loop_show": Words(
        "Open a held item",
        "Shows one held item in full.",
        "Shows the item's details and history, and its email thread if mail reading is on. Scout treats the email's words as information, never as orders.",
        "held",
    ),
    "loop_done": Words(
        "Mark done",
        "Ticks an item off. Your mailbox isn't touched.",
        "Removes the item from Scout's open list. Nothing changes in your email.",
        "held",
    ),
    "loop_later": Words(
        "Snooze",
        "Hides an item until a time you choose.",
        "The item disappears and comes back at the time set.",
        "held",
    ),
    "loop_keep": Words(
        "Keep holding",
        "Keeps an old item on the list for longer.",
        "Items that sit untouched go stale. This keeps one held and restarts its clock.",
        "held",
    ),
    "loop_drop": Words(
        "Drop",
        "Removes an item you no longer need.",
        "Takes the item off the list for good. Nothing changes in your email.",
        "held",
    ),
    "loop_draft": Words(
        "Draft a reply",
        "Leaves a draft reply in your email. Never sends.",
        "Scout writes a draft in the email thread for you to read, edit and send yourself. Needs mail reading on for that app.",
        "held",
    ),
    "inspect_machine": Words(
        "Check this computer",
        "Looks at what's installed so setup works.",
        "Checks your Windows version and tools such as Node and git, so Scout knows what can run here. It only reads.",
        "setup",
    ),
    "find_experts": Words(
        "Find experts",
        "Searches the experts Scout could set up.",
        "Looks through the public list of experts and says which can run on this computer. It only reads.",
        "setup",
    ),
    "find_apps": Words(
        "Find apps",
        "Searches the apps Scout could connect.",
        "Looks through the public list of apps and says which can run on this computer. It only reads.",
        "setup",
    ),
    "install_expert": Words(
        "Install an expert",
        "Downloads an expert, after you allow it.",
        "You see a card listing everything that will be downloaded. It goes into Tagalong's own folder, never the rest of your system.",
        "setup",
    ),
    "install_app": Words(
        "Add an app",
        "Connects a new app, after you allow it.",
        "You see a card saying who made the app (official or community) and what it will run. Some apps then ask you to sign in.",
        "setup",
    ),
    "login_expert": Words(
        "Sign an expert in",
        "Opens a sign-in so an expert uses your account.",
        "Opens a terminal or browser window where you sign in yourself. Scout never sees or passes on your codes.",
        "setup",
    ),
    "web_search": Words(
        "Search the web",
        "Looks up current information online.",
        "Scout searches when it needs something recent or outside what it knows. Each search uses a little of your daily spending limit.",
        "web",
    ),
    "web_fetch": Words(
        "Read a web page",
        "Reads a link you or a search gave it.",
        "Scout opens a page and reads its text. It can only open links that came from you or from a search result.",
        "web",
    ),
    "list_windows": Words(
        "See open windows",
        "Lists your open windows, not what's in them.",
        "Scout sees each window's name and whether it's in front, behind or minimized. It doesn't read the contents, so it's quick and cheap.",
        "computer",
    ),
    "read_window_text": Words(
        "Read a window",
        "Reads the text in one window.",
        "Scout reads the words in one window it names, even if it's behind others or minimized. Windows you marked as blind spots in Privacy are never read.",
        "computer",
    ),
    "look_at_window": Words(
        "Look at a window",
        "Takes a picture of one window.",
        "Used when the layout matters, like a chart or design. A picture costs more than reading text, so Scout prefers reading. Blind spots are never captured.",
        "computer",
    ),
    "open_url": Words(
        "Open a link",
        "Opens a web page in your browser.",
        "Scout opens a secure (https) page, usually a sign-in page for an app you're adding.",
        "computer",
    ),
    "list_files": Words(
        "See files",
        "Lists files in folders you've allowed.",
        "Shows names and sizes inside one allowed folder. Anything outside those folders is refused.",
        "computer",
    ),
    "read_file": Words(
        "Read a file",
        "Reads a text file in an allowed folder.",
        "Scout reads a text file to see what's in it, for example before tidying a folder. It skips pictures and other non-text files.",
        "computer",
    ),
    "move_file": Words(
        "Move files",
        "Moves a file within your allowed folders.",
        "Moves a file or folder to another allowed place. It never overwrites: if something's already there, nothing moves.",
        "computer",
    ),
    "rename_file": Words(
        "Rename files",
        "Renames a file in place.",
        "Gives a file or folder a new name in the same folder. If the name is taken, nothing changes.",
        "computer",
    ),
    "delete_file": Words(
        "Delete files",
        "Sends a file to the Recycle Bin.",
        "The file goes to the Recycle Bin, where you can restore it. Scout asks you every time.",
        "computer",
    ),
    "write_file": Words(
        "Write files",
        "Writes or replaces a file's text.",
        "Creates a file or replaces what's in it; the old text is lost. Scout asks you every time.",
        "computer",
    ),
    "install_ocr_language": Words(
        "Add a reading language",
        "Lets Scout read text in pictures in another language.",
        "Installs Windows' own text recognition for a language, such as French. Windows will also ask for administrator permission.",
        "computer",
    ),
    "tabs": Words(
        "See and read tabs",
        "Lists your tabs and reads the one you need.",
        "Scout finds the tab you mean and reads its text. It can take a picture of the tab in front when the layout matters.",
        "browser",
    ),
    "page_parts": Words(
        "Read page structure",
        "Pulls links, tables or headings from a page.",
        "Used when plain text isn't enough. For forms it sees field names only, never what you typed.",
        "browser",
    ),
    "browser_search": Words(
        "Search your browser",
        "Searches history, bookmarks and downloads.",
        'Looks through your history, bookmarks, reading list, downloads and recently closed tabs, for example "that article from Tuesday". It only reads.',
        "browser",
    ),
    "tab_actions": Words(
        "Work with tabs",
        "Opens, closes, switches or bookmarks tabs.",
        "Scout can open a page or search in a new tab, close or switch tabs, group them, reopen the last closed one, or save a bookmark.",
        "browser",
    ),
}


def words_for(short_name: str, description: str) -> Words | None:
    """The table's words for a built-in or body tool; None when the name is not in the table."""
    return WORDS.get(short_name)


def fallback(short_name: str, description: str) -> tuple[str, str, str]:
    """For a tool the table does not know (an app's, or a renamed body tool): the short name as
    the title, the first sentence of its description as the line and the rest as the info."""
    text = description.strip()
    end = text.find(". ")
    if end < 0:
        return short_name, text, ""
    return short_name, text[: end + 1], text[end + 2 :].strip()
