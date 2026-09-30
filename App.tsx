import { Buffer } from "buffer"; // Run: npm install buffer
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

const manager = new BleManager();

// Replace these with your target device UUIDs
const SERVICE_UUID     = "aee04821-1973-4e1f-a590-e84b10d580e7";
const CHAR_UUID        = "cde07b1a-889b-44b7-a99f-c888dddac729"; //
const CHAR_UUID_NOTIFY = "cde07b1a-889b-44b7-a99f-c888dddac729";
// Same as CHAR_UUID for this example

// ─── Color Palette ─────────────────────────────────────────────────────────
const C = {
  bg:        "#040d1a",
  bgCard:    "#071428",
  bgInput:   "#050f20",
  border:    "#0d3060",
  borderHi:  "#00aaff",
  cyan:      "#00d4ff",
  cyanDim:   "#006688",
  purple:    "#7b2fff",
  green:     "#00ff88",
  greenDim:  "#004433",
  red:       "#ff4466",
  orange:    "#ffaa00",
  textPri:   "#e0f4ff",
  textSec:   "#4a7fa8",
  textMuted: "#1e4060",
  white:     "#ffffff",
};

export default function Index() {
  const [devices,         setDevices        ] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [receivedData,    setReceivedData   ] = useState<string>("");
  const [writeValue,      setWriteValue     ] = useState<string>("");
  const [isScanning,      setIsScanning     ] = useState(false);
  const [statusLog,       setStatusLog      ] = useState("SYSTEM READY");
  const [step,            setStep           ] = useState(0);
  // step: 0 = not read yet, 1 = first read done, 2 = written, 3 = second read done

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isScanning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isScanning]);

  // ── requestPermissions ─────────────────────────────────────────────────────
  async function requestPermissions() {
    manager.stopDeviceScan();
    if (Platform.OS === "android") { // Android 12+ permissions
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted["android.permission.BLUETOOTH_SCAN"]       === PermissionsAndroid.RESULTS.GRANTED &&
          granted["android.permission.BLUETOOTH_CONNECT"]    === PermissionsAndroid.RESULTS.GRANTED &&
          granted["android.permission.ACCESS_FINE_LOCATION"] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else { // Android 11 or lower
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true; // iOS handles this via Info.plist when the scan starts
  }

  useEffect(() => { // Request permissions on mount
    requestPermissions().then((granted) => {
      if (!granted) {
        console.log("Bluetooth permissions not granted");
      }
    });
    return () => {
      manager.stopDeviceScan();
    };
  }, []);

  // ── 1. Scan for Peripherals ─── index.tsx (5) ─────────────────────────────
  const startScan = () => {
    setDevices([]);
    setIsScanning(true);
    setStatusLog("SCANNING FOR DEVICES...");
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.log("Scan error:", error);
        return;
      }
      if (device && device.name) {
        setDevices((prevDevices) => {
          if (prevDevices.some((d) => d.id === device.id)) return prevDevices;
          return [...prevDevices, device];
        });
      }
    });
    setTimeout(() => {
      manager.stopDeviceScan();
      setIsScanning(false);
      setStatusLog("SCAN COMPLETE");
    }, 10000);
  };

  // ── 2. Connect to a Device ─── index.tsx (6) ──────────────────────────────
  const connectToDevice = async (device: Device) => {
    manager.stopDeviceScan();
    setIsScanning(false);
    setStatusLog(`CONNECTING TO ${device.name}...`);
    try {
      const connected = await manager.connectToDevice(device.id);
      // Crucial Step: Discover services and characteristics before interacting
      const discovered = await connected.discoverAllServicesAndCharacteristics();
      setConnectedDevice(discovered);
      setStep(0);
      setReceivedData("");
      setStatusLog(`LINKED ✓ ${discovered.name}`);
      console.log("Connected to:", discovered.name);
    } catch (error) {
      console.log("Connection failed:", error);
      setStatusLog("CONNECTION FAILED");
    }
  };

  // ── 3. READ Mode (Synchronous Pull) ─── index.tsx (7) ────────────────────
  const readCharacteristic = async () => {
    if (!connectedDevice) return;
    setStatusLog("READING CHARACTERISTIC...");
    try {
      const device_id: string = connectedDevice.id.toString();
      const characteristic = await manager.readCharacteristicForDevice(
        device_id,
        SERVICE_UUID,
        CHAR_UUID
      );
      // Decode Base64 string back to readable text/numbers
      const rawData = Buffer.from(characteristic.value || "", "base64").toString("ascii");
      setReceivedData(`Read Value: ${rawData}`);
      setStatusLog("READ SUCCESS ✓");
      console.log("Read Value:", rawData);

      // Track assignment steps
      if (step === 0) setStep(1);       // first read done
      else if (step === 2) setStep(3);  // second read done (grade prediction!)
    } catch (error) {
      console.log("Read failed:", error);
      setStatusLog("READ FAILED");
    }
  };

  // ── 4. WRITE Mode (Push Data) ─── index.tsx (8) ───────────────────────────
  const writeCharacteristic = async () => {
    if (!connectedDevice) return;
    if (!writeValue.trim()) {
      Alert.alert("Input Error", "Please enter a value to write.");
      return;
    }
    setStatusLog("WRITING DATA...");
    try { // Data MUST be converted to Base64
      const base64Value = Buffer.from(writeValue, "utf-8").toString("base64");
      const device_id: string = connectedDevice.id.toString();

      // Use writeCharacteristicWithResponseForDevice() for Write Request
      // Use writeCharacteristicWithoutResponseForDevice() for Write Command
      await manager.writeCharacteristicWithResponseForDevice(
        device_id, SERVICE_UUID, CHAR_UUID, base64Value
      );
      Alert.alert("Write Success", `Value "${writeValue}" written successfully.`);
      setWriteValue(""); // Clear input after successful write
      setStep(2); // written
      setStatusLog("WRITE SUCCESS ✓ — NOW READ AGAIN FOR GRADE");
    } catch (error) {
      console.log("Write failed:", error);
      setStatusLog("WRITE FAILED");
    }
  };

  // ── 5. NOTIFY / INDICATE Mode ─── index.tsx (9) ───────────────────────────
  const startNotificationStream = () => {
    if (!connectedDevice) return;
    setStatusLog("SUBSCRIBING TO NOTIFICATIONS...");
    // monitorCharacteristicForDevice handles both Notifications and Indications
    manager.monitorCharacteristicForDevice(
      connectedDevice.id, SERVICE_UUID, CHAR_UUID_NOTIFY,
      (error, char) => {
        if (error) {
          console.log("Notification error:", error);
          return;
        }
        if (char?.value) {
          const rawData = Buffer.from(char.value, "base64").toString("ascii");
          setReceivedData(`Live Stream: ${rawData}`);
        }
      }
    );
  };

  // ── 6. Disconnect from Device ─── index.tsx (10) ──────────────────────────
  const disconnectDevice = async () => {
    if (!connectedDevice) return;
    try {
      await manager.cancelDeviceConnection(connectedDevice.id);
    } catch (error) {
      console.log("Disconnect error:", error);
    }
    setConnectedDevice(null);
    setReceivedData("");
    setStep(0);
    setStatusLog("DISCONNECTED");
    Alert.alert("Disconnected", "Device has been disconnected.");
  };

  // ── Step guide text ────────────────────────────────────────────────────────
  const getStepGuide = () => {
    switch (step) {
      case 0: return { num: "STEP 1", text: "Press READ VALUE to read the initial message", color: C.cyan };
      case 1: return { num: "STEP 2", text: "Enter your name & buddy, then press WRITE VALUE", color: C.purple };
      case 2: return { num: "STEP 3", text: "Press READ VALUE again to see your grade prediction!", color: C.orange };
      case 3: return { num: "DONE ✓", text: "Grade prediction received! Screenshot this screen", color: C.green };
      default: return { num: "", text: "", color: C.textSec };
    }
  };

  const guide = getStepGuide();

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <View>
          <Text style={s.logo}>◈ BLE</Text>
          <Text style={s.logoSub}>BLUETOOTH LOW ENERGY</Text>
        </View>
        <View style={[s.pill, connectedDevice ? s.pillGreen : s.pillGray]}>
          <View style={[s.dot, connectedDevice ? s.dotGreen : s.dotGray]} />
          <Text style={[s.pillText, { color: connectedDevice ? C.green : C.textSec }]}>
            {connectedDevice ? "LINKED" : "IDLE"}
          </Text>
        </View>
      </View>

      {/* ── STATUS BAR ──────────────────────────────────────────────────── */}
      <View style={s.statusBar}>
        <Text style={s.statusLabel}>SYS ›</Text>
        <Text style={s.statusText}>{statusLog}</Text>
      </View>

      {!connectedDevice ? (
        /* ── SCAN Screen ────────────────────────────────────────────────── */
        <View style={s.screen}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[s.scanBtn, isScanning && s.scanBtnActive]}
              onPress={startScan}
              disabled={isScanning}
              activeOpacity={0.8}
            >
              <Text style={s.scanIcon}>⬡</Text>
              <Text style={s.scanBtnText}>{isScanning ? "SCANNING..." : "SCAN DEVICES"}</Text>
              {isScanning && <Text style={s.scanPulse}>●  ●  ●</Text>}
            </TouchableOpacity>
          </Animated.View>

          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>NEARBY DEVICES</Text>
            <Text style={s.sectionCount}>{devices.length} FOUND</Text>
          </View>

          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            style={s.list}
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Text style={s.emptyIcon}>◎</Text>
                <Text style={s.emptyText}>
                  {isScanning ? "SCANNING AIRSPACE..." : "NO DEVICES DETECTED"}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.deviceCard}
                onPress={() => connectToDevice(item)}
                activeOpacity={0.7}
              >
                <View style={s.deviceCardLeft}>
                  <Text style={s.deviceIcon}>◈</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.deviceName}>{item.name}</Text>
                    <Text style={s.deviceId} numberOfLines={1}>{item.id}</Text>
                  </View>
                </View>
                <View style={s.deviceRight}>
                  <Text style={s.rssi}>{item.rssi}</Text>
                  <Text style={s.rssiUnit}>dBm</Text>
                  <Text style={s.connectArrow}>›</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        /* ── CONNECTED Screen ───────────────────────────────────────────── */
        <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Device info card */}
          <View style={s.connectedCard}>
            <View style={s.connectedCardTop}>
              <Text style={s.connectedIcon}>◈</Text>
              <View>
                <Text style={s.connectedLabel}>CONNECTED DEVICE</Text>
                <Text style={s.connectedName}>{connectedDevice.name}</Text>
              </View>
            </View>
            <Text style={s.connectedId} numberOfLines={1}>{connectedDevice.id}</Text>
          </View>

          {/* Step guide */}
          <View style={[s.guideCard, { borderColor: guide.color }]}>
            <Text style={[s.guideStep, { color: guide.color }]}>{guide.num}</Text>
            <Text style={s.guideText}>{guide.text}</Text>
          </View>

          {/* Characteristic data display */}
          <View style={s.dataCard}>
            <Text style={s.dataLabel}>◤ CHARACTERISTIC DATA</Text>
            <Text style={[s.dataValue, step === 3 && { color: C.orange, fontSize: 18 }]}>
              {receivedData || "── NO DATA FETCHED YET ──"}
            </Text>
          </View>

          {/* READ */}
          <ActionButton
            label="READ VALUE"
            icon="↓"
            color={C.cyan}
            onPress={readCharacteristic}
            highlight={step === 0 || step === 2}
          />

          {/* Divider */}
          <View style={s.divider}><Text style={s.dividerText}>── WRITE DATA ──</Text></View>

          {/* Name input */}
          <View style={s.inputWrapper}>
            <Text style={s.inputLabel}>ENTER YOUR NAME ›</Text>
            <TextInput
              style={s.input}
              value={writeValue}
              onChangeText={setWriteValue}
              placeholder="Your name and buddy (e.g. Alice Bob)"
              placeholderTextColor={C.textMuted}
              selectionColor={C.cyan}
            />
          </View>

          {/* WRITE */}
          <ActionButton
            label="WRITE VALUE"
            icon="↑"
            color={C.purple}
            onPress={writeCharacteristic}
            highlight={step === 1}
          />

          {/* Subscribe (disabled as in reference) */}
          <ActionButton label="SUBSCRIBE TO NOTIFICATIONS" icon="≋" color={C.green} onPress={startNotificationStream} disabled />

          {/* DISCONNECT */}
          <ActionButton label="DISCONNECT" icon="⊗" color={C.red} onPress={disconnectDevice} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Reusable Action Button ─────────────────────────────────────────────────
function ActionButton({ label, icon, color, onPress, disabled = false, highlight = false }: {
  label: string; icon: string; color: string; onPress: () => void;
  disabled?: boolean; highlight?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        s.actionBtn,
        { borderColor: disabled ? C.textMuted : color, opacity: disabled ? 0.35 : 1 },
        highlight && { backgroundColor: color + "18", borderWidth: 2 },
      ]}
      onPress={onPress} disabled={disabled} activeOpacity={0.75}
    >
      <Text style={[s.actionIcon, { color }]}>{icon}</Text>
      <Text style={[s.actionLabel, { color: disabled ? C.textMuted : color }]}>{label}</Text>
      {highlight && <Text style={{ color, fontSize: 10, letterSpacing: 2 }}>◂</Text>}
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.bg },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
                    borderBottomWidth: 1, borderBottomColor: C.border },
  logo:           { fontSize: 22, fontWeight: "900", color: C.cyan, letterSpacing: 4 },
  logoSub:        { fontSize: 9, color: C.textSec, letterSpacing: 3, marginTop: 1 },
  pill:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 10,
                    paddingVertical: 5, borderRadius: 20, borderWidth: 1, gap: 6 },
  pillGreen:      { borderColor: C.green, backgroundColor: C.greenDim },
  pillGray:       { borderColor: C.border, backgroundColor: C.bgCard },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  dotGreen:       { backgroundColor: C.green },
  dotGray:        { backgroundColor: C.textSec },
  pillText:       { fontSize: 10, fontWeight: "bold", letterSpacing: 2 },
  statusBar:      { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 20, paddingVertical: 8,
                    backgroundColor: C.bgCard, borderBottomWidth: 1, borderBottomColor: C.border },
  statusLabel:    { fontSize: 10, color: C.cyanDim, fontWeight: "bold", letterSpacing: 2 },
  statusText:     { fontSize: 10, color: C.textSec, letterSpacing: 1, flex: 1 },
  screen:         { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  scanBtn:        { borderWidth: 2, borderColor: C.cyanDim, borderRadius: 12,
                    paddingVertical: 20, alignItems: "center", marginBottom: 20,
                    backgroundColor: "#031020" },
  scanBtnActive:  { borderColor: C.cyan, backgroundColor: "#041828" },
  scanIcon:       { fontSize: 28, color: C.cyan, marginBottom: 4 },
  scanBtnText:    { color: C.cyan, fontWeight: "bold", fontSize: 15, letterSpacing: 4 },
  scanPulse:      { color: C.cyanDim, fontSize: 10, marginTop: 8, letterSpacing: 6 },
  sectionHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle:   { fontSize: 11, color: C.textSec, letterSpacing: 3, fontWeight: "bold" },
  sectionCount:   { fontSize: 11, color: C.cyan, letterSpacing: 2 },
  list:           { flex: 1 },
  emptyBox:       { alignItems: "center", paddingVertical: 40 },
  emptyIcon:      { fontSize: 36, color: C.textMuted, marginBottom: 12 },
  emptyText:      { color: C.textMuted, letterSpacing: 3, fontSize: 11 },
  deviceCard:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    backgroundColor: C.bgCard, borderWidth: 1, borderColor: C.border,
                    borderRadius: 10, padding: 14, marginBottom: 8 },
  deviceCardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  deviceIcon:     { fontSize: 20, color: C.cyan },
  deviceName:     { color: C.textPri, fontWeight: "bold", fontSize: 14 },
  deviceId:       { color: C.textSec, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  deviceRight:    { alignItems: "center" },
  rssi:           { color: C.green, fontSize: 16, fontWeight: "bold" },
  rssiUnit:       { color: C.textSec, fontSize: 9 },
  connectArrow:   { color: C.cyan, fontSize: 22, marginTop: 2 },
  connectedCard:  { backgroundColor: C.bgCard, borderWidth: 1, borderColor: C.borderHi,
                    borderRadius: 12, padding: 16, marginBottom: 12 },
  connectedCardTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  connectedIcon:  { fontSize: 28, color: C.cyan },
  connectedLabel: { fontSize: 9, color: C.cyan, letterSpacing: 3 },
  connectedName:  { fontSize: 16, fontWeight: "bold", color: C.white },
  connectedId:    { fontSize: 10, color: C.textSec, letterSpacing: 1 },
  guideCard:      { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 12,
                    backgroundColor: C.bgCard, flexDirection: "row", alignItems: "center", gap: 10 },
  guideStep:      { fontSize: 11, fontWeight: "bold", letterSpacing: 2 },
  guideText:      { fontSize: 12, color: C.textSec, flex: 1 },
  dataCard:       { backgroundColor: "#020a14", borderWidth: 1, borderColor: C.border,
                    borderRadius: 10, padding: 16, marginBottom: 14 },
  dataLabel:      { fontSize: 9, color: C.textSec, letterSpacing: 3, marginBottom: 10 },
  dataValue:      { color: C.green, fontSize: 14, letterSpacing: 1, textAlign: "center" },
  actionBtn:      { flexDirection: "row", alignItems: "center", gap: 12,
                    borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 10,
                    backgroundColor: C.bgCard },
  actionIcon:     { fontSize: 20, width: 24, textAlign: "center" },
  actionLabel:    { fontSize: 13, fontWeight: "bold", letterSpacing: 2, flex: 1 },
  divider:        { marginVertical: 14, alignItems: "center" },
  dividerText:    { color: C.textMuted, fontSize: 10, letterSpacing: 3 },
  inputWrapper:   { marginBottom: 10 },
  inputLabel:     { fontSize: 9, color: C.textSec, letterSpacing: 3, marginBottom: 6 },
  input:          { backgroundColor: C.bgInput, borderWidth: 1, borderColor: C.border,
                    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14,
                    fontSize: 14, color: C.textPri, letterSpacing: 1 },
});
