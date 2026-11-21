import Foundation

/// Screens pushed onto a tab's NavigationStack.
enum Route: Hashable {
    case describe
    case job(id: String)
}
