package io.github.collinrandolph.streamingtracker;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds Rokus on the Wi-Fi with an SSDP search (the same one the PC helper sends), since the web view
 * can't send UDP. Returns their IP addresses; the app then reads each one's name over ECP.
 */
@CapacitorPlugin(name = "RokuFind")
public class RokuFindPlugin extends Plugin {
    private static final String SEARCH =
        "M-SEARCH * HTTP/1.1\r\nHost: 239.255.255.250:1900\r\nMan: \"ssdp:discover\"\r\nST: roku:ecp\r\nMX: 3\r\n\r\n";
    private static final Pattern LOCATION = Pattern.compile("(?im)^location:\\s*http://([\\d.]+):8060");

    @PluginMethod
    public void find(PluginCall call) {
        new Thread(() -> {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = wifi == null ? null : wifi.createMulticastLock("roku-find");
            Set<String> ips = new LinkedHashSet<>();
            try (DatagramSocket sock = new DatagramSocket()) {
                if (lock != null) lock.acquire();
                byte[] msg = SEARCH.getBytes(StandardCharsets.US_ASCII);
                InetAddress group = InetAddress.getByName("239.255.255.250");
                for (int i = 0; i < 3; i++) sock.send(new DatagramPacket(msg, msg.length, group, 1900));
                long until = System.currentTimeMillis() + 3500;
                byte[] buf = new byte[2048];
                while (System.currentTimeMillis() < until) {
                    sock.setSoTimeout((int) Math.max(1, until - System.currentTimeMillis()));
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try {
                        sock.receive(p);
                    } catch (SocketTimeoutException e) {
                        break;
                    }
                    Matcher m = LOCATION.matcher(new String(p.getData(), 0, p.getLength(), StandardCharsets.US_ASCII));
                    if (m.find()) ips.add(m.group(1));
                }
                JSObject out = new JSObject();
                JSArray list = new JSArray();
                for (String ip : ips) list.put(ip);
                out.put("ips", list);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("Couldn't search the Wi-Fi for a Roku: " + e.getMessage());
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
            }
        }).start();
    }
}
