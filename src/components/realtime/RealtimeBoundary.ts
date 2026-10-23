"use client";

import React from "react";
import { realtimeClient } from "@/lib/realtime/client";

interface Props {
  topic: string;
  route: string;
  fallback: (retry: () => void) => React.ReactNode;
  children: React.ReactNode;
  onRetry?: () => void;
}
interface State { failed: boolean }

export class RealtimeBoundary extends React.Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidMount() { this.listen = realtimeClient.onError(this.props.topic, (error) => {
    realtimeClient.markDegraded(this.props.topic);
    this.setState({ failed: true });
    console.error("Realtime boundary fallback", { topic: this.props.topic, route: this.props.route, transport: "websocket", error: error.name });
  }); }
  componentWillUnmount() { this.listen?.(); }
  private listen?: () => void;
  componentDidCatch(error: Error) { realtimeClient.markDegraded(this.props.topic, error, this.props.route); }
  retry = () => {
    realtimeClient.retry(this.props.topic);
    this.setState({ failed: false });
    this.props.onRetry?.();
  };
  render() { return this.state.failed ? this.props.fallback(this.retry) : this.props.children; }
}
