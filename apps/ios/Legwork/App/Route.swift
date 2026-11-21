import Foundation

/// Screens pushed onto the app's NavigationStack (Home is the root).
enum Route: Hashable {
    case describe
    case job(id: String)
    /// A list of this phone's jobs: every open job ("See all") or the finished ones (S13).
    case jobs(JobsList)
}

/// Which jobs a pushed jobs list shows.
enum JobsList: Hashable {
    case open
    case completed
}
