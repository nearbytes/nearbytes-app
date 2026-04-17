import Capacitor
import UIKit
import CapApp_SPM

class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NearbytesLanPlugin())
        bridge?.registerPluginInstance(NearbytesProviderPlugin())
        super.capacitorDidLoad()
    }
}