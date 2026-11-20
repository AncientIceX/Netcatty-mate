package de.newaii.netcatty;

import java.io.IOException;

/** Per-connection output-only gate. Never sends XOFF/XON to the remote shell. */
public final class TerminalOutputFlow {
    public static final int WINDOW = 65536;
    private boolean paused;
    private boolean closed;
    private int pending;

    public synchronized void reserve(int bytes) throws IOException, InterruptedException {
        while (!closed && (paused || pending + bytes > WINDOW)) wait();
        if (closed) throw new IOException("Terminal output closed");
        pending += bytes;
    }
    public synchronized void acknowledge(int bytes) {
        pending = Math.max(0, pending - Math.max(0, bytes));
        notifyAll();
    }
    public synchronized void setPaused(boolean value) throws IOException {
        if (closed) throw new IOException("Terminal output closed");
        paused = value;
        notifyAll();
    }
    public synchronized boolean isClosed() { return closed; }
    public synchronized void finish() throws InterruptedException {
        while (!closed && pending > 0) wait();
    }
    public synchronized void close() { closed = true; notifyAll(); }
}
