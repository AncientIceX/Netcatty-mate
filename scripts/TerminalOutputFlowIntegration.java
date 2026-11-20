import de.newaii.netcatty.TerminalOutputFlow;
import java.util.concurrent.atomic.AtomicBoolean;

public class TerminalOutputFlowIntegration {
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        final TerminalOutputFlow gate = new TerminalOutputFlow();
        gate.reserve(65536);
        final AtomicBoolean delivered = new AtomicBoolean();
        Thread writer = new Thread(new Runnable() { public void run() { try { gate.reserve(7); delivered.set(true); } catch(Exception e) { throw new RuntimeException(e); } }});
        writer.start(); Thread.sleep(80); check(!delivered.get(), "window must bound producer");
        gate.setPaused(true); gate.acknowledge(65536); Thread.sleep(80); check(!delivered.get(), "ack must not override pause");
        gate.setPaused(false); writer.join(1000); check(delivered.get(), "resume must deliver retained bytes");
        gate.acknowledge(7); gate.finish();
        gate.setPaused(true);
        final AtomicBoolean closed = new AtomicBoolean();
        Thread waiting = new Thread(new Runnable() { public void run() { try { gate.reserve(1); } catch(Exception e) { closed.set(true); } }});
        waiting.start(); Thread.sleep(80); gate.close(); waiting.join(1000); check(closed.get(), "close must wake producer");
        TerminalOutputFlow fresh = new TerminalOutputFlow();fresh.reserve(1);fresh.acknowledge(1);fresh.finish();
        System.out.println("PASS native production output gate: 64KiB window, pause versus ack, retained resume, finish, close wakeup, independent reconnect");
    }
}
