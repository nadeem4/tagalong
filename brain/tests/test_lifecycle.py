"""Checks the brain's pid file and the stop logic on fakes: no real process is ever signalled."""

from brain.lifecycle import clear_pid, pid_path, stop_brain, write_pid


class Fakes:
    def __init__(self, alive=True, dies=True, started="t1"):
        self.is_alive, self.dies, self.killed, self.live_started = alive, dies, [], started

    def alive(self, pid):
        return self.is_alive

    def kill(self, pid):
        self.killed.append(pid)

    def wait(self, pid):
        return not self.dies

    def started(self, pid):
        return self.live_started

    def stop(self, home):
        return stop_brain(
            home, alive=self.alive, kill=self.kill, wait=self.wait, started=self.started
        )


def test_write_then_clear_removes_the_file(tmp_path):
    write_pid(tmp_path, 123, "t1")
    assert pid_path(tmp_path).read_text().split()[0] == "123"
    clear_pid(tmp_path, 123)
    assert not pid_path(tmp_path).exists()


def test_clear_leaves_another_brains_pid(tmp_path):
    write_pid(tmp_path, 456, "t1")
    clear_pid(tmp_path, 123)
    assert pid_path(tmp_path).read_text().split()[0] == "456"


def test_stop_kills_a_live_pid_and_removes_the_file(tmp_path):
    write_pid(tmp_path, 123, "t1")
    fakes = Fakes()
    assert fakes.stop(tmp_path) == "stopped"
    assert fakes.killed == [123]
    assert not pid_path(tmp_path).exists()


def test_stop_with_no_file_is_not_running(tmp_path):
    fakes = Fakes()
    assert fakes.stop(tmp_path) == "not_running"
    assert fakes.killed == []


def test_stop_with_an_unreadable_file_is_not_running_and_cleans_up(tmp_path):
    pid_path(tmp_path).write_text("not a number")
    assert Fakes().stop(tmp_path) == "not_running"
    assert not pid_path(tmp_path).exists()


def test_stop_with_a_dead_pid_is_not_running_and_cleans_up(tmp_path):
    write_pid(tmp_path, 123, "t1")
    fakes = Fakes(alive=False)
    assert fakes.stop(tmp_path) == "not_running"
    assert fakes.killed == []
    assert not pid_path(tmp_path).exists()


def test_stop_reports_failed_if_it_will_not_die(tmp_path):
    write_pid(tmp_path, 123, "t1")
    assert Fakes(dies=False).stop(tmp_path) == "failed"
    assert pid_path(tmp_path).exists()


def test_stop_never_kills_a_live_process_that_is_not_the_brain(tmp_path):
    write_pid(tmp_path, 123, "t1")
    fakes = Fakes(started="t2")  # the pid was reused by another process
    assert fakes.stop(tmp_path) == "not_running"
    assert fakes.killed == []
    assert not pid_path(tmp_path).exists()
