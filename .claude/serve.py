import http.server


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        if path.endswith(('.mjs', '.js')):
            return 'text/javascript'
        return super().guess_type(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.test(HandlerClass=Handler, port=8421)
